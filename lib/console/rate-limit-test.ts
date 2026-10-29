import 'server-only';import {sql} from 'drizzle-orm';import {db} from '@/lib/db';
// Fixed-window atomic limiter for local contracts, not a production perimeter.
export async function fixtureRateLimit(key:string,max:number,windowMs:number,now=new Date()){
 if(process.env.CONSOLE_ONBOARDING_TEST_ONLY!=='true'||new URL(process.env.DATABASE_URL!).hostname!=='127.0.0.1')throw Error('Local limiter only');
 const result=await db.execute(sql`INSERT INTO console_rate_limits (key,window_start,attempts) VALUES (${key},${now.toISOString()}::timestamp,1)
 ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN console_rate_limits.window_start <= ${new Date(now.getTime()-windowMs).toISOString()}::timestamp THEN 1 ELSE console_rate_limits.attempts+1 END,
 window_start=CASE WHEN console_rate_limits.window_start <= ${new Date(now.getTime()-windowMs).toISOString()}::timestamp THEN ${now.toISOString()}::timestamp ELSE console_rate_limits.window_start END RETURNING attempts`);
 return Number(result[0]?.attempts)<=max;
}
