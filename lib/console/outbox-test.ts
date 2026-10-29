import 'server-only';
import {randomUUID} from 'node:crypto';
import {and,eq,inArray,lt,sql} from 'drizzle-orm';
import {db} from '@/lib/db';import {consoleOutbox} from './schema';
// Local simulation of bounded worker retries. Adapter cannot report a sent result.
export async function processDryRunOutbox(id:string,preview:(item:{id:string;kind:string;recipient:string})=>Promise<{sent:false}>,now=new Date()){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local dry-run only');
 const claimId=randomUUID();
 const [claimed]=await db.update(consoleOutbox).set({status:'previewing',claimedAt:now,claimId,attempts:sql`${consoleOutbox.attempts}+1`}).where(and(eq(consoleOutbox.id,id),inArray(consoleOutbox.status,['dry-run','retry']),lt(consoleOutbox.attempts,3))).returning();
 if(!claimed)return {claimed:false,sent:false};
 try{const result=await preview({id:claimed.id,kind:claimed.kind,recipient:claimed.recipient});if(result.sent!==false)throw Error('Dry-run may not send');const finished=await db.update(consoleOutbox).set({status:'previewed'}).where(and(eq(consoleOutbox.id,id),eq(consoleOutbox.status,'previewing'),eq(consoleOutbox.claimId,claimId))).returning({id:consoleOutbox.id});return {claimed:true,previewed:finished.length===1,sent:false};
 }catch{await db.update(consoleOutbox).set({status:claimed.attempts>=3?'dead-letter':'retry'}).where(and(eq(consoleOutbox.id,id),eq(consoleOutbox.status,'previewing'),eq(consoleOutbox.claimId,claimId)));return {claimed:true,previewed:false,sent:false};}
}

// An interrupted delivery is ambiguous. Quarantine it, do not auto-resend.
export async function quarantineStaleDryRuns(now=new Date()){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local dry-run only');
 return db.update(consoleOutbox).set({status:'unknown-outcome'}).where(and(eq(consoleOutbox.status,'previewing'),lt(consoleOutbox.claimedAt,new Date(now.getTime()-300000)))).returning({id:consoleOutbox.id});
}
// Explicit local reconciliation never sends or silently retries an ambiguous item.
export async function reconcileDryRun(id:string,decision:'confirmed-previewed'|'discard',actor:string,reason:string){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local dry-run only');
 if(!actor||reason.trim().length<8||!['confirmed-previewed','discard'].includes(decision))throw Error('Reconciliation requires actor and reason');
 const {consoleAudit}=await import('./schema');
 return db.transaction(async tx=>{
  const [item]=await tx.select().from(consoleOutbox).where(eq(consoleOutbox.id,id)).for('update');
  if(!item||!['unknown-outcome','dead-letter'].includes(item.status))return {changed:false,sent:false};
  await tx.update(consoleOutbox).set({status:decision==='discard'?'discarded':'previewed'}).where(eq(consoleOutbox.id,id));
  await tx.insert(consoleAudit).values({id:randomUUID(),organizationId:item.organizationId,actorId:actor,subjectId:id,action:decision==='discard'?'outbox.discarded':'outbox.preview.confirmed'});
  return {changed:true,sent:false};
 });
}
