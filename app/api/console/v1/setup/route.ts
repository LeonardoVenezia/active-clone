import {NextResponse} from 'next/server';
import {and,eq,inArray} from 'drizzle-orm';
import {auth} from '@/lib/auth';import {db} from '@/lib/db';
import {members,organizations,workflows} from '@/lib/db/schema';
import {consoleSetups,consoleAssignments,consoleAudit} from '@/lib/console/schema';
import {randomUUID} from 'node:crypto';
const enabled=()=>process.env.CONSOLE_PERSISTENT_CONFIG_ENABLED==='true'&&process.env.CONSOLE_SETUP_PREPARATION_ENABLED==='true';
export async function GET(request:Request){try{
 if(!enabled())return NextResponse.json({enabled:false,items:[]});
 const s=await auth.api.getSession({headers:request.headers});if(!s?.user||s.user.isAnonymous||!s.user.emailVerified)return NextResponse.json({error:'Ingresá con email verificado.'},{status:401});
 const owned=await db.select({id:organizations.id,name:organizations.name}).from(members).innerJoin(organizations,eq(organizations.id,members.organizationId)).where(and(eq(members.userId,s.user.id),eq(members.role,'owner')));
 const flows=await db.select({id:workflows.id,name:workflows.name}).from(workflows).where(eq(workflows.userId,s.user.id));
 const stored=await db.select().from(consoleAssignments);const setups=await db.select().from(consoleSetups);
 return NextResponse.json({enabled:true,activationAvailable:process.env.CONSOLE_OWNER_ACTIVATION_ENABLED==='true',items:owned.map(o=>({...o,prepared:setups.some(x=>x.organizationId===o.id&&x.ownerId===s.user.id),active:setups.some(x=>x.organizationId===o.id&&x.ownerId===s.user.id&&x.enabled),workflows:flows.filter(w=>!stored.some(a=>a.workflowId===w.id&&a.organizationId!==o.id)),selected:stored.filter(a=>a.organizationId===o.id).map(a=>({workflowId:a.workflowId,teamId:a.teamId}))}))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'No pudimos cargar la preparación.'},{status:503})}}
export async function POST(request:Request){try{
 if(!enabled())return NextResponse.json({error:'Preparación no habilitada.'},{status:503});
 if(!process.env.CONSOLE_ORIGIN||request.headers.get('origin')!==process.env.CONSOLE_ORIGIN)return NextResponse.json({error:'Origen no permitido.'},{status:403});
 const s=await auth.api.getSession({headers:request.headers});if(!s?.user||s.user.isAnonymous||!s.user.emailVerified)return NextResponse.json({error:'Ingresá con email verificado.'},{status:401});
 const raw=await request.text();if(raw.length>16384)return NextResponse.json({error:'Datos demasiado grandes.'},{status:413});const b=JSON.parse(raw);
 if(typeof b.organizationId!=='string'||!Array.isArray(b.assignments)||b.assignments.length>100||b.assignments.some((a:any)=>typeof a.workflowId!=='string'||a.teamId!==null&&(typeof a.teamId!=='string'||!a.teamId.trim()||a.teamId.length>80))||new Set(b.assignments.map((a:any)=>a.workflowId)).size!==b.assignments.length)return NextResponse.json({error:'Revisá workflows y equipos.'},{status:400});
 if(b.activate===true&&process.env.CONSOLE_OWNER_ACTIVATION_ENABLED!=='true')return NextResponse.json({error:'Activación pendiente de definición. Podés guardar la preparación.'},{status:403});
 const ok=await db.transaction(async tx=>{
 const [member]=await tx.select().from(members).where(and(eq(members.organizationId,b.organizationId),eq(members.userId,s.user.id),eq(members.role,'owner'))).for('update');if(!member)return false;
 const own=await tx.select().from(workflows).where(eq(workflows.userId,s.user.id));if(b.assignments.some((a:any)=>!own.some(w=>w.id===a.workflowId)))return false;
 const [old]=await tx.select().from(consoleSetups).where(eq(consoleSetups.organizationId,b.organizationId)).for('update');if(old&&old.ownerId!==s.user.id||old?.enabled)return false;
 await tx.insert(consoleSetups).values({organizationId:b.organizationId,ownerId:s.user.id,enabled:b.activate===true}).onConflictDoUpdate({target:consoleSetups.organizationId,set:{updatedAt:new Date(),enabled:b.activate===true}});
 await tx.delete(consoleAssignments).where(eq(consoleAssignments.organizationId,b.organizationId));
 if(b.assignments.length)await tx.insert(consoleAssignments).values(b.assignments.map((a:any)=>({organizationId:b.organizationId,workflowId:a.workflowId,teamId:a.teamId,updatedBy:s.user.id})));
 await tx.insert(consoleAudit).values({id:randomUUID(),organizationId:b.organizationId,actorId:s.user.id,subjectId:b.organizationId,action:b.activate===true?'console.activated':'console.prepared'});return true;
 });return ok?NextResponse.json({ok:true,message:b.activate===true?'Consola habilitada. No se ejecutó ningún workflow.':'Preparación guardada sin habilitar acceso.'}):NextResponse.json({error:'Fuera de tu alcance o consola activa; no se cambió la configuración.'},{status:403});
 }catch(e:any){return NextResponse.json({error:e?.code==='23505'?'Un workflow ya pertenece a otra empresa.':'No pudimos guardar la preparación.'},{status:409})}}
