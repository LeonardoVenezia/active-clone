import{test}from'node:test';import assert from'node:assert/strict';import{companyRunScopes,canRunWithCompanyVariables}from'../../lib/company/run-policy';
test('run scopes only exact owner organization workflow, absent config and flags closed',()=>{
 delete process.env.COMPANY_VARIABLE_RUN_SCOPES;delete process.env.COMPANY_VARIABLES_POLICY_APPROVED;delete process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED;
 assert.deepEqual(companyRunScopes(),[]);
 assert(!canRunWithCompanyVariables({userId:'u',organizationId:'o',workflowId:'w'}));
 process.env.COMPANY_VARIABLE_RUN_SCOPES=JSON.stringify([{ownerId:'u',organizationId:'o',workflowId:'w'}]);
 assert(!canRunWithCompanyVariables({userId:'u',organizationId:'o',workflowId:'w'}));
 process.env.COMPANY_VARIABLES_POLICY_APPROVED='true';
 assert(!canRunWithCompanyVariables({userId:'u',organizationId:'o',workflowId:'w'}));
 process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED='true';
 assert(canRunWithCompanyVariables({userId:'u',organizationId:'o',workflowId:'w'}));
 assert(!canRunWithCompanyVariables({userId:'x',organizationId:'o',workflowId:'w'}));
 assert(!canRunWithCompanyVariables({userId:'u',organizationId:'x',workflowId:'w'}));
 assert(!canRunWithCompanyVariables({userId:'u',organizationId:'o',workflowId:'x'}));
 process.env.COMPANY_VARIABLE_RUN_SCOPES='not-json';
 assert(!canRunWithCompanyVariables({userId:'u',organizationId:'o',workflowId:'w'}));
 process.env.COMPANY_VARIABLE_RUN_SCOPES=JSON.stringify([{ownerId:'u',organizationId:'o',workflowId:''},{ownerId:'u2',organizationId:'o2',workflowId:'w2'}]);
 assert.deepEqual(companyRunScopes(),[{ownerId:'u2',organizationId:'o2',workflowId:'w2'}]);
 delete process.env.COMPANY_VARIABLE_RUN_SCOPES;delete process.env.COMPANY_VARIABLES_POLICY_APPROVED;delete process.env.COMPANY_VARIABLES_STEP_RUNTIME_ENABLED;
});
test('console owner run scopes are exact and deny by default',async()=>{
 const {consoleOwnerRunScopes,consoleOwnerRunWorkflowIds}=await import('../../lib/company/run-policy');
 delete process.env.CONSOLE_OWNER_RUN_SCOPES;
 assert.deepEqual(consoleOwnerRunScopes(),[]);
 process.env.CONSOLE_OWNER_RUN_SCOPES='not json';
 assert.deepEqual(consoleOwnerRunScopes(),[]);
 // Entries without a workflow id are rejected: scoping is per workflow.
 process.env.CONSOLE_OWNER_RUN_SCOPES=JSON.stringify([{organizationId:'o',ownerId:'u'},{organizationId:'x'}]);
 assert.deepEqual(consoleOwnerRunScopes(),[]);
 process.env.CONSOLE_OWNER_RUN_SCOPES=JSON.stringify([{organizationId:'o',ownerId:'u',workflowId:'w1'},{organizationId:'o',ownerId:'v',workflowId:'w2'}]);
 assert.deepEqual(consoleOwnerRunWorkflowIds('u','o'),['w1']);
 assert.deepEqual(consoleOwnerRunWorkflowIds('v','o'),['w2']);
 assert.deepEqual(consoleOwnerRunWorkflowIds('u','x'),[]);
 delete process.env.CONSOLE_OWNER_RUN_SCOPES;
});

test('canExecute limits owner-scope runs to the exact workflow',async()=>{
 const {canExecute}=await import('../../lib/console/policy');
 const grant:any={userId:'u',organizationId:'o',role:'owner',teamIds:[],workflowIds:[],canRun:true,runWorkflowIds:['w1']};
 const a1:any={workflowId:'w1',organizationId:'o',teamId:null};
 const a2:any={workflowId:'w2',organizationId:'o',teamId:null};
 assert.equal(canExecute(grant,a1,true,true),true);
 assert.equal(canExecute(grant,a2,true,true),false);
 // Without runWorkflowIds the grant-wide flag applies unchanged.
 const plain:any={userId:'u',organizationId:'o',role:'owner',teamIds:[],workflowIds:[],canRun:true};
 assert.equal(canExecute(plain,a2,true,true),true);
 const denied:any={...plain,canRun:false};
 assert.equal(canExecute(denied,a1,true,true),false);
});
