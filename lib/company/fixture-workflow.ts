import {withCompanyVariablesInsideStep} from './step-variables';
// No network, provider, AI or dynamic action dispatch in this fixture.
export async function companyFixtureStep(input:{executionId:string;workflowId:string;config:unknown}){
 'use step';
 return withCompanyVariablesInsideStep(input,async resolved=>({success:true,data:{kind:'company-variable-fixture',resolved}}),async()=>{})
}
companyFixtureStep.maxRetries=0;
export async function companyFixtureWorkflow(input:{executionId:string;workflowId:string;config:unknown}){
 'use workflow';
 try{const result=await companyFixtureStep(input);await finishCompanyFixture(input.executionId,result);return result}catch{await failCompanyFixture(input.executionId);throw Error("La prueba aislada no pudo completarse. Revisá las variables requeridas.")}
}
async function finishCompanyFixture(executionId:string,result:unknown){
 'use step';
 const{db}=await import('@/lib/db');const{workflowExecutions}=await import('@/lib/db/schema');const{eq}=await import('drizzle-orm');await db.update(workflowExecutions).set({status:'success',output:result,completedAt:new Date()}).where(eq(workflowExecutions.id,executionId));
}

async function failCompanyFixture(executionId:string){
 'use step';
 const{db}=await import('@/lib/db');const{workflowExecutions}=await import('@/lib/db/schema');const{eq}=await import('drizzle-orm');await db.update(workflowExecutions).set({status:'error',error:'La prueba aislada no pudo completarse. Revisá las variables requeridas.',completedAt:new Date()}).where(eq(workflowExecutions.id,executionId));
}
