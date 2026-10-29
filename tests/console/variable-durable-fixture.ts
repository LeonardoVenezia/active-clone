import {withCompanyVariablesInsideStep} from '@/lib/company/step-variables';
export async function variableFixtureStep(input:{executionId:string;workflowId:string;config:unknown;fail:boolean}){
 'use step';
 return withCompanyVariablesInsideStep(input,async resolved=>{if(input.fail)throw Error('Fictitious provider error '+(resolved as any).body);return {echo:(resolved as any).body}},async record=>{console.log('VARIABLE_FIXTURE_REDACTED_RECORD',JSON.stringify(record))})
}
export async function variableFixtureWorkflow(input:{executionId:string;workflowId:string;config:unknown;fail:boolean}){
 'use workflow';
 try{return await variableFixtureStep(input)}catch(error){return {caught:String(error)}}
}
