import 'server-only';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {fixtureRateLimit} from './rate-limit-test';
import {and,eq,gt} from 'drizzle-orm';
import {db} from '@/lib/db';
import {users,accounts} from '@/lib/db/schema';
import {hashPassword} from 'better-auth/crypto';
import {consoleInvitations,consoleOutbox,consoleVerification} from './schema';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
// Private dry-run contract only. No HTTP signup endpoint, email transport, or real URL.
export async function registerInvitedFixture(emailInput:string,password:string,capture:(challenge:{id:string;token:string})=>void){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local fixture contract only');
 const email=emailInput.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>128)throw Error('Invalid registration');
 if(!await fixtureRateLimit('register:'+digest(email),3,900000))throw Error('Registration temporarily limited');
 const [invite]=await db.select().from(consoleInvitations).where(and(eq(consoleInvitations.email,email),eq(consoleInvitations.status,'pending'),gt(consoleInvitations.expiresAt,new Date())));
 if(!invite)throw Error('No active invitation');
 const id=randomUUID(),challengeId=randomUUID(),token=randomBytes(32).toString('hex'),now=new Date();const hash=await hashPassword(password);
 await db.transaction(async tx=>{
  await tx.insert(users).values({id,name:'Fictitious invited account',email,emailVerified:false,createdAt:now,updatedAt:now});
  await tx.insert(accounts).values({id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:hash,createdAt:now,updatedAt:now});
  await tx.insert(consoleVerification).values({id:challengeId,userId:id,tokenHash:digest(token),expiresAt:new Date(Date.now()+900000)});
  await tx.insert(consoleOutbox).values({id:randomUUID(),organizationId:invite.organizationId,recipient:email,kind:'verify-email',dedupeKey:'verify:'+challengeId,status:'dry-run'});
 });
 capture({id:challengeId,token});return {userId:id,emailVerified:false,delivery:'dry-run'};
}
export async function verifyFixtureEmail(id:string,token:string,now=new Date()){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local fixture contract only');
 if(typeof id!=='string'||typeof token!=='string'||id.length>128||token.length>128)return false;
 if(!await fixtureRateLimit('verify:'+digest(id),5,900000,now))return false;
 return db.transaction(async tx=>{
  const [v]=await tx.select().from(consoleVerification).where(eq(consoleVerification.id,id)).for('update');
  if(!v||v.used||v.expiresAt<=now||v.tokenHash!==digest(token))return false;
  await tx.update(users).set({emailVerified:true,updatedAt:new Date()}).where(eq(users.id,v.userId));
  await tx.update(consoleVerification).set({used:true}).where(eq(consoleVerification.id,id));return true;
 });
}
export async function queueDryRunNotice(input:{organizationId:string;recipient:string;kind:'failure'|'connection'|'approval';eventId:string}){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local fixture contract only');
 const id=randomUUID();const rows=await db.insert(consoleOutbox).values({id,organizationId:input.organizationId,recipient:input.recipient,kind:input.kind,dedupeKey:input.organizationId+':'+input.kind+':'+input.eventId,status:'dry-run'}).onConflictDoNothing().returning({id:consoleOutbox.id});return {queued:rows.length===1,sent:false};
}
