import 'server-only';
import {randomUUID} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {integrations} from '@/lib/db/schema';
import {consoleReconnects,consoleAudit} from './schema';
import {consoleContext} from './context';
import {visibleWorkflows} from './data';
import {encrypt} from '@/lib/db/integrations';
async function scope(request:Request,integrationId:string){
 const ctx=await consoleContext(request);if(!ctx||!['owner','admin'].includes(ctx.grant.role))throw Error('Not authorized');
 const flows=await visibleWorkflows(ctx.grant,null);const [row]=await db.select().from(integrations).where(eq(integrations.id,integrationId));
 if(!row||!flows.some(w=>w.userId===row.userId&&(w.nodes as any[]).some(n=>n.data?.config?.integrationId===row.id)))throw Error('Not authorized');
 // A credential shared with a workflow outside this organization is unsafe to mutate.
 const {workflows}=await import('@/lib/db/schema');const {assignments}=await import('./data');
 const owned=await db.select().from(workflows).where(eq(workflows.userId,row.userId));
 const mapped=assignments(null);
 if(owned.some(w=>(w.nodes as any[]).some(n=>n.data?.config?.integrationId===row.id)&&!mapped.some(a=>a.workflowId===w.id&&a.organizationId===ctx.grant.organizationId)))throw Error('Connection used outside verified tenant');
 return {ctx,row};
}
// Server-side preparation only. No public credentials endpoint or real provider adapter exists yet.
export async function prepareReconnect(request:Request,integrationId:string){
 if(process.env.CONSOLE_RECONNECT_ENABLED!=='true')throw Error('Reconnect not enabled');
 const {ctx,row}=await scope(request,integrationId);const id=randomUUID();
 await db.insert(consoleReconnects).values({id,organizationId:ctx.grant.organizationId,integrationId:row.id,ownerId:row.userId,actorId:ctx.user.id,expectedVersion:(await db.select({v:sql<string>`${integrations.updatedAt}::text`}).from(integrations).where(eq(integrations.id,row.id)))[0].v,expiresAt:new Date(Date.now()+600000)});
 return {id,integrationId:row.id,expiresInSeconds:600};
}
// Called only by a future verified provider callback, never with browser-supplied config.
export async function finishReconnect(request:Request,ticketId:string,verified:{providerType:string;config:Record<string,unknown>},claimed=false){
 if(process.env.CONSOLE_RECONNECT_ENABLED!=='true')throw Error('Reconnect not enabled');
 const [candidate]=await db.select().from(consoleReconnects).where(eq(consoleReconnects.id,ticketId));if(!candidate)throw Error('Invalid reconnect');
 const {ctx,row}=await scope(request,candidate.integrationId);
 if(candidate.actorId!==ctx.user.id||candidate.organizationId!==ctx.grant.organizationId||candidate.ownerId!==row.userId||verified.providerType!==row.type)throw Error('Invalid reconnect');
 const ciphertext=encrypt(JSON.stringify(verified.config));
 return db.transaction(async tx=>{
  const [ticket]=await tx.select().from(consoleReconnects).where(eq(consoleReconnects.id,ticketId)).for('update');
  if(!ticket||ticket.status!==(claimed?'exchanging':'pending')||ticket.expiresAt<=new Date())throw Error('Invalid reconnect');
  const updated=await tx.update(integrations).set({config:ciphertext,updatedAt:new Date()}).where(and(eq(integrations.id,ticket.integrationId),eq(integrations.userId,ticket.ownerId),sql`${integrations.updatedAt}::text = ${ticket.expectedVersion}`)).returning({id:integrations.id});
  if(updated.length!==1)throw Error('Connection changed; begin again');
  await tx.update(consoleReconnects).set({status:'completed'}).where(eq(consoleReconnects.id,ticketId));
  await tx.insert(consoleAudit).values({id:randomUUID(),organizationId:ticket.organizationId,actorId:ctx.user.id,subjectId:ticket.integrationId,action:'connection.reconnected'});
  return {ok:true,integrationId:updated[0].id};
 });
}
export type ReconnectProviderAdapter={
 type:string;
 exchange:(authorizationCode:string)=>Promise<{config:Record<string,unknown>;verified:boolean}>;
};
// Contract for an eventual provider callback. Adapters are server-injected, never selected by request JSON.
export async function completeProviderCallback(request:Request,input:{ticketId:string;state:string;code:string},adapter:ReconnectProviderAdapter){
 if(process.env.CONSOLE_RECONNECT_ENABLED!=='true')throw Error('Reconnect not enabled');
 if(input.state!==input.ticketId||!input.code||input.code.length>2048)throw Error('Invalid callback');
 const [ticket]=await db.select().from(consoleReconnects).where(eq(consoleReconnects.id,input.ticketId));
 if(!ticket||ticket.status!=='pending'||ticket.expiresAt<=new Date())throw Error('Invalid callback');
 const {ctx,row}=await scope(request,ticket.integrationId);
 if(ctx.user.id!==ticket.actorId||ctx.grant.organizationId!==ticket.organizationId||row.type!==adapter.type)throw Error('Invalid callback');
 const reserved=await db.update(consoleReconnects).set({status:'exchanging'}).where(and(eq(consoleReconnects.id,input.ticketId),eq(consoleReconnects.status,'pending'))).returning({id:consoleReconnects.id});
 if(reserved.length!==1)throw Error('Callback already claimed');
 try{
  const credential=await adapter.exchange(input.code);if(!credential.verified)throw Error('Provider did not verify credentials');
  return await finishReconnect(request,input.ticketId,{providerType:adapter.type,config:credential.config},true);
 }catch(e){await db.update(consoleReconnects).set({status:'failed'}).where(and(eq(consoleReconnects.id,input.ticketId),eq(consoleReconnects.status,'exchanging')));throw e;}

}
