import {httpRequestStep} from '@/lib/steps/http-request';
export async function httpCompanyFixture(input:{executionId:string;workflowId:string;mode:string}){
 'use workflow';
 return httpRequestStep({endpoint:'http://127.0.0.1:4302/'+input.mode,httpMethod:'POST',httpHeaders:'{"x-fixture":"{{company.API_KEY}}"}',httpBody:'{"arbitrary":"{{company.API_KEY}}"}',_context:{executionId:input.executionId,workflowId:input.workflowId,nodeId:'http-fixture',nodeName:'HTTP fixture',nodeType:'HTTP Request'}})
}
