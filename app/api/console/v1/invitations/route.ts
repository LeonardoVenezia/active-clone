import {NextResponse} from 'next/server';
import {and,eq,or,desc,lt} from 'drizzle-orm';
import {randomUUID} from 'node:crypto';
import {auth} from '@/lib/auth';
import {db} from '@/lib/db';
import {consoleContext} from '@/lib/console/context';
import {consoleInvitations,consoleMemberships,consoleGrants,consoleAudit} from '@/lib/console/schema';
import {effectiveGrant} from '@/lib/console/grants';
import {hasConsoleAffiliation} from '@/lib/console/affiliation';
import {canManageGrant,parseGrant} from '@/lib/console/policy';
import {assignments} from '@/lib/console/data';
const enabled=()=>process.env.CONSOLE_INVITATIONS_ENABLED==='true'&&process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED==='true'&&process.env.CONSOLE_STORAGE_ENABLED==='true';
export async function GET(request:Request){try{
 if(!enabled())return NextResponse.json({items:[],enabled:false,emailDeliveryAvailable:false});
 const session=await auth.api.getSession({headers:request.headers});if(!session?.user||session.user.isAnonymous)return NextResponse.json({error:'No autorizado.'},{status:401});
 const ctx=await consoleContext(request);const own=eq(consoleInvitations.email,session.user.email.toLowerCase());
 let scope=own;
 if(ctx&&['owner','admin','manager'].includes(ctx.grant.role))scope=or(own,eq(consoleInvitations.organizationId,ctx.grant.organizationId))!;
 const rows=await db.select().from(consoleInvitations).where(scope).orderBy(desc(consoleInvitations.createdAt)).limit(100);
 const items=rows.filter(row=>row.email===session.user.email.toLowerCase()||ctx&&canManageGrant(ctx.grant,null,{...row,userId:'invitation-recipient'} as any)).map(row=>({id:row.id,email:row.email,organizationId:row.organizationId,role:row.role,status:row.status,expiresAt:row.expiresAt,teamIds:row.teamIds,workflowIds:row.workflowIds,canRun:row.canRun,incoming:row.email===session.user.email.toLowerCase()}));
 return NextResponse.json({items,enabled:true,emailDeliveryAvailable:false},{headers:{'Cache-Control':'no-store'}});
}catch{return NextResponse.json({error:'No pudimos cargar las invitaciones.'},{status:503})}}
export async function POST(request:Request){try{
 if(!enabled())return NextResponse.json({error:'Invitaciones no habilitadas.'},{status:503});
 if(!process.env.CONSOLE_ORIGIN||request.headers.get('origin')!==process.env.CONSOLE_ORIGIN)return NextResponse.json({error:'Origen no permitido.'},{status:403});
 const text=await request.text();if(text.length>4096)return NextResponse.json({error:'Datos demasiado grandes.'},{status:413});const body=JSON.parse(text);
 const session=await auth.api.getSession({headers:request.headers});if(!session?.user||session.user.isAnonymous||!session.user.emailVerified)return NextResponse.json({error:'Ingresá con un email verificado.'},{status:401});
 if(body.action==='accept'){
  if(typeof body.id!=='string')return NextResponse.json({error:'Invitación no válida.'},{status:400});
  const result=await db.transaction(async tx=>{
   const [inv]=await tx.select().from(consoleInvitations).where(eq(consoleInvitations.id,body.id)).for('update');
   if(!inv||inv.email!==session.user.email.toLowerCase()||inv.status!=='pending'||inv.expiresAt<=new Date())return false;
   const actor=await effectiveGrant(inv.inviterId,inv.organizationId);const grant={...inv,userId:session.user.id};
   if(!actor||!await hasConsoleAffiliation(inv.inviterId,inv.organizationId)||!canManageGrant(actor,await effectiveGrant(session.user.id,inv.organizationId),grant as any))return false;
   const current=await effectiveGrant(session.user.id,inv.organizationId);
   const activeAssignments=assignments(null).filter(a=>a.organizationId===inv.organizationId);
   if(actor.role==='manager'&&current?.workflowIds.some(id=>!activeAssignments.some(a=>a.workflowId===id&&a.teamId&&actor.teamIds.includes(a.teamId))))return false;
   if(inv.workflowIds.some(id=>!activeAssignments.some(a=>a.workflowId===id&&(actor.role!=='manager'||a.teamId&&actor.teamIds.includes(a.teamId))))||inv.teamIds.some(id=>!activeAssignments.some(a=>a.teamId===id)))return false;
   await tx.insert(consoleMemberships).values({organizationId:inv.organizationId,userId:session.user.id}).onConflictDoUpdate({target:[consoleMemberships.organizationId,consoleMemberships.userId],set:{enabled:true}});
   await tx.insert(consoleGrants).values({organizationId:inv.organizationId,userId:session.user.id,role:inv.role,teamIds:inv.teamIds,workflowIds:inv.workflowIds,canRun:inv.canRun,enabled:true,updatedBy:inv.inviterId}).onConflictDoUpdate({target:[consoleGrants.organizationId,consoleGrants.userId],set:{role:inv.role,teamIds:inv.teamIds,workflowIds:inv.workflowIds,canRun:inv.canRun,enabled:true,updatedBy:inv.inviterId,updatedAt:new Date()}});
   await tx.update(consoleInvitations).set({status:'accepted'}).where(eq(consoleInvitations.id,inv.id));
   await tx.insert(consoleAudit).values({id:randomUUID(),organizationId:inv.organizationId,actorId:session.user.id,subjectId:session.user.id,action:'invitation.accepted'});return true;
  });return result?NextResponse.json({ok:true,message:'Acceso solo a consola aceptado. No se agregó membresía del editor.'}):NextResponse.json({error:'Invitación no válida o permisos del emisor ya no vigentes.'},{status:403});
 }
 const ctx=await consoleContext(request);if(!ctx||!['owner','admin','manager'].includes(ctx.grant.role))return NextResponse.json({error:'No autorizado.'},{status:403});
 if(body.action==='cancel'){
  const [inv]=await db.select().from(consoleInvitations).where(and(eq(consoleInvitations.id,body.id||''),eq(consoleInvitations.organizationId,ctx.grant.organizationId)));
  if(!inv||!canManageGrant(ctx.grant,null,{...inv,userId:'invitation-recipient'} as any))return NextResponse.json({error:'Fuera de tu alcance.'},{status:403});
  await db.update(consoleInvitations).set({status:'cancelled'}).where(and(eq(consoleInvitations.id,inv.id),eq(consoleInvitations.status,'pending')));return NextResponse.json({ok:true});
 }
 const email=typeof body.email==='string'?body.email.toLowerCase().trim():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||email===session.user.email.toLowerCase())return NextResponse.json({error:'Email no válido.'},{status:400});
 const next=parseGrant(JSON.stringify({organizations:{[ctx.grant.organizationId]:{users:{recipient:body}}}}),'recipient',ctx.grant.organizationId);
 if(!next||!canManageGrant(ctx.grant,null,next))return NextResponse.json({error:'Permisos fuera de tu alcance.'},{status:403});
 const allowed=assignments(null).filter(a=>a.organizationId===ctx.grant.organizationId);
 if(next.workflowIds.some(id=>!allowed.some(a=>a.workflowId===id&&(ctx.grant.role!=='manager'||a.teamId&&ctx.grant.teamIds.includes(a.teamId))))||next.teamIds.some(id=>!allowed.some(a=>a.teamId===id)))return NextResponse.json({error:'Asignación fuera de tu alcance.'},{status:403});
 const id=randomUUID();await db.transaction(async tx=>{await tx.update(consoleInvitations).set({status:'expired'}).where(and(eq(consoleInvitations.organizationId,ctx.grant.organizationId),eq(consoleInvitations.email,email),eq(consoleInvitations.status,'pending'),lt(consoleInvitations.expiresAt,new Date())));await tx.insert(consoleInvitations).values({id,organizationId:ctx.grant.organizationId,email,inviterId:session.user.id,role:next.role,teamIds:next.teamIds,workflowIds:next.workflowIds,canRun:next.canRun,expiresAt:new Date(Date.now()+86400000)});});
 return NextResponse.json({id,message:'Invitación guardada. No se envió correo. La persona debe ingresar con su email verificado.'},{status:201});
}catch(e:any){return NextResponse.json({error:e?.code==='23505'?'Ya hay una invitación pendiente para ese email.':'No pudimos guardar la invitación.'},{status:e?.code==='23505'?409:503})}}
