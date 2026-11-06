import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createRequire } from "node:module";
import Module from "node:module";
const require = createRequire(import.meta.url);
const resolver = Module as typeof Module & { _resolveFilename: (request: string, ...args: unknown[]) => string };
const originalResolve = resolver._resolveFilename;
resolver._resolveFilename = function (request, ...args) {
  if (request === "server-only") return require.resolve("../semantic/stubs/server-only.ts");
  return originalResolve.call(this, request, ...args);
};
const { generateWorkflowCode } = require("../../lib/workflow-codegen");
const { generateWorkflowSDKCode } = require("../../lib/workflow-codegen-sdk");
resolver._resolveFilename = originalResolve;
import type { WorkflowNode } from "../../lib/workflow-store";
const nodes: WorkflowNode[] = [{id:"t",type:"trigger",position:{x:0,y:0},data:{type:"trigger",label:"Manual",config:{triggerType:"Manual"}}}];
for (const policy of ["stop","continue",undefined]) {
  test(`exports ${policy || "legacy"} preserve usable policy code`,()=>{
    const input=nodes.map(n=>({...n,data:{...n.data,config:{...n.data.config,onError:policy}}}));
    for (const code of [generateWorkflowCode(input,[]).code,generateWorkflowSDKCode("Test",input,[])]) {
      assert.equal(code.includes("__policyRun"),Boolean(policy));
      assert.equal(code.includes("this flow uses an explicit error policy"),false);
      const output=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
      assert.deepEqual(output.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
    }
  });
}
import vm from "node:vm";
const n=(id:string,action:string,config:Record<string,unknown>={}):WorkflowNode=>({id,type:"action",position:{x:0,y:0},data:{type:"action",label:id,config:{actionType:action,...config}}});
async function execute(format:string,ns:WorkflowNode[],pairs:string[][],responses:Record<string,unknown>={}) {
 const edges=pairs.map(([source,target])=>({id:source+target,source,target}));
 const code=format==="plain"?generateWorkflowCode(ns,edges).code:generateWorkflowSDKCode("Test",ns,edges);
 const calls:string[]=[];
 const mock=async(input:any)=>{const endpoint=input.endpoint??input.url; calls.push(endpoint); if(endpoint==="throw")throw Error("offline thrown");if(input.httpBody) JSON.parse(input.httpBody);return responses[endpoint]??{value:endpoint};};
 const context={exports:{},require:(id:string)=>id==="workflow"?{sleep:async()=>{},createHook:()=>Promise.resolve({approved:false})}:{httpRequestStep:mock},fetch:async(endpoint:string,options:any)=>{if(options?.body) JSON.parse(options.body);const body=await mock({endpoint});return {headers:{get:()=>"application/json"},json:async()=>body,text:async()=>JSON.stringify(body)}},process:{env:{}},console};
 const transpiled=ts.transpileModule(code,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});assert.deepEqual(transpiled.diagnostics,[]);const js=transpiled.outputText;
 require("node:fs").writeFileSync(`/tmp/error-policy-generated-${format}.ts`,code);
 if(ns.some(n=>n.id==="cond"))require("node:fs").writeFileSync(`/tmp/error-policy-condition-${format}.ts`,code);
 vm.runInNewContext(js,context);
 const fn=Object.values(context.exports)[0] as (input:unknown)=>Promise<any>;
 const result=await fn({hello:"world"});
 return {result,calls,code};
}
for(const format of ["plain","sdk"]) {
 for(const mode of ["stop","continue"]) for(const kind of ["returned","thrown"]) test(`${format} executed ${mode} ${kind} failure`,async()=>{
  const a=kind==="returned"?"fail":"throw";
  const ns=[...nodes,n("a","HTTP Request",{endpoint:a,httpMethod:"GET",onError:mode}),n("b","HTTP Request",{endpoint:"{{@a:A.error}}",httpMethod:"GET"})];
  const {result,calls}=await execute(format,ns,[["t","a"],["a","b"]],{fail:{success:false,error:{message:"offline returned"}}});
  assert.equal(result.success,false);assert.equal(result.results.a.success,false);assert.equal(Boolean(result.results.b),mode==="continue");assert.equal(calls.length,mode==="continue"?2:1);
  if(mode==="continue") assert.equal(calls[1],kind==="returned"?"offline returned":"offline thrown");
 });
 test(`${format} error outputs feed real Condition expressions`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","HTTP Request",{endpoint:"fail",onError:"continue"}),n("cond","Condition",{condition:"{{@a:A.success}} === false",onError:"stop"}),n("b","HTTP Request",{endpoint:"matched"})],[["t","a"],["a","cond"],["cond","b"]],{fail:{success:false,error:"bad"}});assert.equal(result.success,false);assert.equal(calls.join(),"fail,matched");});
 test(`${format} preexisting unsupported nodes refuse before effects`,async()=>{await assert.rejects(()=>execute(format,[...nodes,n("a","HTTP Request",{endpoint:"no",onError:"continue"}),n("u","Unir")],[["t","a"],["a","u"]]),/Export not supported/);});
 test(`${format} JSON error interpolation remains valid and missing fields empty`,async()=>{
  const error='quote " line\nbackslash \\';
  const {calls,result}=await execute(format,[...nodes,n("a","HTTP Request",{endpoint:"fail",onError:"continue"}),n("b","HTTP Request",{endpoint:"{{@a:A.missing}}",httpBody:'{"error":"{{@a:A.error}}"}'})],[["t","a"],["a","b"]],{fail:{success:false,error}});
  assert.equal(result.success,false);assert.equal(calls[1],"");
 });
 test(`${format} Delay validation continues without sleep effects`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","Delay",{durationSeconds:-1,onError:"continue"}),n("b","HTTP Request",{endpoint:"after"})],[["t","a"],["a","b"]]);assert.equal(result.success,false);assert.equal(result.results.a.success,false);assert.equal(calls[0],"after");});
 test(`${format} disabled failure is skipped and continues`,async()=>{const disabled=n("a","HTTP Request",{endpoint:"fail",onError:"stop"});disabled.data.enabled=false;const {result,calls}=await execute(format,[...nodes,disabled,n("b","HTTP Request",{endpoint:"after"})],[["t","a"],["a","b"]]);assert.equal(result.success,true);assert.equal(calls.join(),"after");});
 test(`${format} unknown action failure is visible and continues`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","Unknown",{onError:"continue"}),n("b","HTTP Request",{endpoint:"after"})],[["t","a"],["a","b"]]);assert.equal(result.success,false);assert.equal(result.results.a.success,false);assert.equal(calls.join(),"after");});
 test(`${format} all-success exports are usable`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","HTTP Request",{endpoint:"ok",onError:"stop"})],[["t","a"]]);assert.equal(result.success,true);assert.equal(calls.join(),"ok");});
 test(`${format} approval rejection stops despite continue`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","Approval",{onError:"continue"}),n("b","HTTP Request",{endpoint:"protected"})],[["t","a"],["a","b"]]);assert.equal(result.success,false);assert.equal(calls.length,0);});
 test(`${format} false Condition filters all descendants`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","Condition",{condition:"false",onError:"continue"}),n("b","HTTP Request",{endpoint:"no"}),n("c","HTTP Request",{endpoint:"also-no"})],[["t","a"],["a","b"],["a","c"]]);assert.equal(result.success,true);assert.equal(calls.length,0);});
 test(`${format} parallel branch survives stop and merged child runs once`,async()=>{const {result,calls}=await execute(format,[...nodes,n("a","HTTP Request",{endpoint:"fail",onError:"stop"}),n("b","HTTP Request",{endpoint:"ok"}),n("c","HTTP Request",{endpoint:"merged"})],[["t","a"],["t","b"],["a","c"],["b","c"]],{fail:{success:false,error:"failed"}});assert.equal(result.success,false);assert.equal(calls.filter(x=>x==="merged").length,1);});
}
