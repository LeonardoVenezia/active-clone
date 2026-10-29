import 'server-only';
import {and,eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {members} from '@/lib/db/schema';
import {consoleMemberships,consoleSessions} from './schema';
export async function hasConsoleAffiliation(userId:string,organizationId:string){
 if(process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED==='true'){
  const [row]=await db.select().from(consoleMemberships).where(and(eq(consoleMemberships.userId,userId),eq(consoleMemberships.organizationId,organizationId)));
  // An explicit revocation wins over a product membership.
  if(row)return row.enabled;
 }
 return !!await db.query.members.findFirst({where:and(eq(members.userId,userId),eq(members.organizationId,organizationId))});
}
export async function selectedConsoleOrganization(sessionId:string,fallback:string|null|undefined){
 if(process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED==='true'){
  const [row]=await db.select().from(consoleSessions).where(eq(consoleSessions.sessionId,sessionId));
  if(row)return row.organizationId;
 }
 return fallback;
}
