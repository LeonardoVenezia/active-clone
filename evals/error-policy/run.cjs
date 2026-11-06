// Bundles the REAL executor. Only effects, imports of providers and durable wait/logging are stubbed.
const esbuild = require('../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const path = require('node:path');
async function main() {
await esbuild.build({entryPoints:['lib/action-config-defaults.ts'],outfile:'/tmp/error-policy-defaults.cjs',bundle:true,platform:'node',format:'cjs'});
await esbuild.build({entryPoints:['evals/error-policy/entry.ts'],outfile:'/tmp/error-policy-executor.cjs',bundle:true,platform:'node',format:'cjs',plugins:[{name:'safe-effects',setup(build){build.onResolve({filter:/^(workflow|\.\/step-registry|\.\/steps\/(trigger|join|execution-status|approval|database-query|http-request|condition|formula|frontend|datos))$/},()=>({path:path.resolve('evals/error-policy/stubs.ts')}));}}]});
// The stub is bundled into the executor, so record calls via test output configs rather than shared module state.
const {executeWorkflow,calls,completions} = require('/tmp/error-policy-executor.cjs');
const assert = require('node:assert/strict');
const node = (id,actionType,config={}) => ({id,position:{x:0,y:0},data:{type:actionType==='Trigger'?'trigger':'action',label:id,config:{...(actionType==='Trigger'?{triggerType:'Manual'}:{actionType}),...config}}});
const edges = (...pairs) => pairs.map(([source,target])=>({id:`${source}-${target}`,source,target}));
const run = (nodes,links,extra={}) => executeWorkflow({nodes,edges:edges(...links),...extra});
const tests=[];
const test = async (name,fn) => { await fn(); tests.push(name); console.error('PASS',name); };
await (async()=>{
 for (const action of ['Fail','Throw','Unknown']) {
  for (const onError of [undefined,'stop','continue']) await test(`${action} ${onError||'legacy'}`,async()=>{
   const r=await run([node('t','Trigger'),node('a',action,{onError}),node('b','Echo',{error:'{{@a:A.error}}',ok:'{{@a:A.success}}'})],[['t','a'],['a','b']]);
   assert.equal(r.success,false); assert.equal(r.results.a.success,false);
   assert.equal(Boolean(r.results.b),onError==='continue');
   if(onError==='continue'){assert.equal(r.results.b.data.data.ok,'false');assert.ok(r.results.b.data.data.error.length);}
  });
 }
 await test('new action selection inherits safe default without migrating old configs',async()=>{
  const {withActionDefaults}=require('/tmp/error-policy-defaults.cjs');
  assert.equal(withActionDefaults({},'Echo').onError,'stop');
  assert.equal(withActionDefaults({onError:'continue'},'Echo').onError,'continue');
 });
 await test('trigger returned failure continues visibly',async()=>{const r=await run([node('t','Trigger',{onError:'continue'}),node('b','Echo')],[['t','b']],{triggerInput:{fail:true}});assert.equal(r.success,false);assert.ok(r.results.b);});
 await test('approval rejection never releases protected node',async()=>{const r=await run([node('t','Trigger'),node('a','Approval',{onError:'continue'}),node('b','Echo')],[['t','a'],['a','b']]);assert.equal(r.success,false);assert.equal(r.results.b,undefined);});
 await test('condition false stays a filter with continue',async()=>{const r=await run([node('t','Trigger'),node('a','Condition',{condition:'false',onError:'continue'}),node('b','Echo')],[['t','a'],['a','b']]);assert.equal(r.success,true);assert.equal(r.results.b,undefined);});
 await test('stop leaves unrelated branches running',async()=>{const r=await run([node('t','Trigger'),node('a','Fail',{onError:'stop'}),node('b','Echo')],[['t','a'],['t','b']]);assert.equal(r.success,false);assert.ok(r.results.b);});
 for(const onError of [undefined,'stop','continue']) await test(`Loop ${onError||'legacy'}`,async()=>{
  const r=await run([node('t','Trigger'),node('a','Loop',{onError,source:'[1,2,3]',steps:[{id:'f',actionType:'Fail'},{id:'after',actionType:'Echo',config:{seen:'{{@f:F.success}}'}}]}),node('b','Echo')],[['t','a'],['a','b']]);
  const d=r.results.a.data;
  assert.equal(r.success,!onError);assert.equal(d.failed.length,onError==='stop'?1:3);assert.equal(Boolean(r.results.b),onError!=='stop');
  if(onError==='continue'){assert.equal(d.items[0].steps.after.data.seen,'false');assert.equal(d.processed,3);assert.equal(r.outputs.a.data.failedCount,3);assert.equal(r.outputs.a.data.success,false);}
  if(onError==='stop'){assert.equal(d.processed,1);assert.equal(d.stopped,true);}
 });
 await test('Loop rejection never releases later steps or outer branch',async()=>{const r=await run([node('t','Trigger'),node('a','Loop',{onError:'continue',source:'[1,2]',steps:[{actionType:'Approval'},{actionType:'Echo'}]}),node('b','Echo')],[['t','a'],['a','b']]);assert.equal(r.results.a.data.processed,1);assert.equal(r.results.b,undefined);assert.equal(r.success,false);});
 for (const cfg of [{},{onParentFailure:'continue'},{onError:'stop',onParentFailure:'continue'},{onError:'continue'}]) await test(`Unir ${JSON.stringify(cfg)}`,async()=>{
  const r=await run([node('t','Trigger'),node('a','Fail',{onError:'continue'}),node('b','Echo'),node('j','Unir',cfg),node('c','Echo')],[['t','a'],['t','b'],['a','j'],['b','j'],['j','c']]);
  assert.equal(r.success,false);assert.deepEqual(r.results.j.data.failed,['a']);assert.deepEqual(r.results.j.data.completed,['b']);assert.equal(Boolean(r.results.c),cfg.onError==='continue'||(!cfg.onError&&cfg.onParentFailure==='continue'));
 });
 await test('Unir timeout continue preserves missing parents',async()=>{const r=await run([node('t','Trigger'),node('a','Wait'),node('b','Echo'),node('j','Unir',{onError:'continue',joinMode:'timeout',timeoutSeconds:1}),node('c','Echo')],[['t','a'],['t','b'],['a','j'],['b','j'],['j','c']]);assert.deepEqual(r.results.j.data.timedOut,['a']);assert.ok(r.results.c);});
 await test('completion record remains error after continue',async()=>{const r=await run([node('t','Trigger'),node('a','Fail',{onError:'continue'}),node('b','Echo')],[['t','a'],['a','b']],{executionId:'offline-only'});assert.equal(r.success,false);assert.equal(completions.at(-1).status,'error');assert.equal(completions.at(-1).error,'returned failure');});
 await test('disabled nodes still bypass without creating errors',async()=>{const disabled=node('a','Fail',{onError:'continue'});disabled.data.enabled=false;const r=await run([node('t','Trigger'),disabled,node('b','Echo')],[['t','a'],['a','b']]);assert.equal(r.success,true);assert.ok(r.results.b);});
 await test('merged child runs once after failed-continued and successful parent',async()=>{const before=calls.length;await run([node('t','Trigger'),node('a','Fail',{onError:'continue'}),node('b','Echo'),node('c','Echo')],[['t','a'],['t','b'],['a','c'],['b','c']]);assert.equal(calls.slice(before).filter(c=>c._context.nodeId==='c').length,1);});
 await test('Unir all parents failed preserves errors and continues explicitly',async()=>{const r=await run([node('t','Trigger'),node('a','Fail'),node('j','Unir',{onError:'continue'}),node('c','Echo')],[['t','a'],['a','j'],['j','c']]);assert.equal(r.success,false);assert.equal(r.results.j.success,false);assert.deepEqual(r.outputs.j.data.failed,['a']);assert.equal(r.outputs.j.data.success,false);assert.ok(r.results.c);});
 await test('company guard is not bypassed by continue',async()=>{const before=calls.length;await assert.rejects(()=>run([node('t','Trigger',{onError:'continue',value:'{{company.SECRET}}'}),node('b','Echo')],[['t','b']]),/not enabled/);assert.equal(calls.length,before);});
 require('node:fs').writeFileSync('/tmp/error-policy-executor-results.json',JSON.stringify({count:tests.length,tests},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>esbuild.stop());

}
main().catch(e=>{console.error(e);process.exitCode=1;});
