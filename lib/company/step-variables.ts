import 'server-only';
import {and,eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {workflowExecutions} from '@/lib/db/schema';
import {managementWorkflowScopes} from '@/lib/console/schema';
import {companyVariableKeys,resolveCompanyVariables} from '@/lib/company-variables';
import {variableDefinitions} from '@/lib/company-variable-contract';
import {readRuntimeVariable} from './variables';
import {scrubCompanyValues} from '@/lib/company-variable-redaction';
// Inert execution seam. Call ONLY inside an audited durable step, never in the
// workflow before step invocation. Do not wire a provider until its own logging,
// errors and outputs are verified. Runtime remains separately closed.
export async function withCompanyVariablesInsideStep<T>(input:{executionId:string;workflowId:string;config:unknown},run:(resolved:unknown)=>Promise<T>,record:(data:unknown)=>Promise<void>):Promise<unknown>{
 const keys=companyVariableKeys(input.config);if(!keys.length)return run(input.config);
 if(process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED!=='true'||process.env.COMPANY_VARIABLES_POLICY_APPROVED!=='true')throw Error('Company variable runtime is not enabled');
 const [execution]=await db.select({id:workflowExecutions.id}).from(workflowExecutions).where(and(eq(workflowExecutions.id,input.executionId),eq(workflowExecutions.workflowId,input.workflowId)));
 const [scope]=await db.select().from(managementWorkflowScopes).where(eq(managementWorkflowScopes.workflowId,input.workflowId));
 if(!execution||!scope)throw Error('Company variable execution scope missing');
 const defs=variableDefinitions(process.env.COMPANY_VARIABLE_DEFINITIONS,scope.organizationId);const values:Record<string,string>=Object.create(null);const secrets:string[]=[];
 for(const key of keys){const def=defs.find(d=>d.key===key);if(!def)throw Error('Company variable is not declared');const value=await readRuntimeVariable(scope.organizationId,key);values[key]=value;if(def.secret)secrets.push(value)}
 const resolved=resolveCompanyVariables(input.config,values);
 try{const result=await run(resolved);const safe=scrubCompanyValues(result,secrets);await record({input:scrubCompanyValues(resolved,secrets),output:safe});return safe}catch(error){const safe=scrubCompanyValues(error instanceof Error?error.message:'Company variable step failed',secrets);await record({status:'error',error:safe});throw Error(String(safe))}
}
