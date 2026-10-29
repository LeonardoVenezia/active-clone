import {NextResponse} from 'next/server';
import {and,eq,desc,inArray,or} from 'drizzle-orm';
import {consoleContext} from '@/lib/console/context';
import {db} from '@/lib/db';
import {consoleAudit} from '@/lib/console/schema';
import {visibleWorkflows} from '@/lib/console/data';
import {GET as team} from '../team/route';
export async function GET(request:Request){try{
 const ctx=await consoleContext(request);if(!ctx)return NextResponse.json({error:'No autorizado.'},{status:401});
 if(process.env.CONSOLE_STORAGE_ENABLED!=='true')return NextResponse.json({items:[],available:false});
 const clauses=[eq(consoleAudit.organizationId,ctx.grant.organizationId)];
 if(ctx.grant.role==='operator')clauses.push(eq(consoleAudit.actorId,ctx.user.id));
 else if(ctx.grant.role==='manager'){
  const roster=await (await team(request)).json();if(!Array.isArray(roster.items))return NextResponse.json({error:'No pudimos verificar el alcance.'},{status:503});
  const ids=[ctx.user.id,...roster.items.filter((r:any)=>r.editable).map((r:any)=>r.id),...(await visibleWorkflows(ctx.grant,null)).map(w=>w.id)];
  clauses.push(or(eq(consoleAudit.actorId,ctx.user.id),inArray(consoleAudit.subjectId,ids))!);
 }
 const rows=await db.select({id:consoleAudit.id,actorId:consoleAudit.actorId,subjectId:consoleAudit.subjectId,action:consoleAudit.action,createdAt:consoleAudit.createdAt}).from(consoleAudit).where(and(...clauses)).orderBy(desc(consoleAudit.createdAt)).limit(100);
 return NextResponse.json({items:rows,available:true,limit:100},{headers:{'Cache-Control':'no-store'}});
}catch{return NextResponse.json({error:'No pudimos cargar las acciones.'},{status:503})}}
