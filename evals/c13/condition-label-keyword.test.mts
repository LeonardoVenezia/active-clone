import assert from "node:assert/strict";
import * as mod from "../../lib/condition-validator";
const V: any = (mod as any).default ?? mod;
const pre = V.preValidateConditionExpression;
const post = V.validateConditionExpression;

const ok = (e: string) => assert.equal(pre(e).valid, true, e);
const bad = (e: string) => assert.equal(pre(e).valid, false, e);

// Regression: keyword inside a step label (template ref) is allowed
ok("{{@n4:Comparar y evaluar umbral.result.avisa.taza}} === 'si'");
ok("{{@n4:Process data.result.x}} === 'si'");
// Real dangerous code stays blocked, with or without refs around it
bad("eval('1')");
bad("{{@n4:Paso.result.x}} === 'si' && eval('1')");
bad("{{@n4:Paso.result.x}} && require('fs')");
bad("{{@n4:Paso.result.x}} && globalThis.process");
bad("{{@n4:Paso.result.x}}.constructor");
bad("{{@n4:Paso.result.x}} && Function('x')()");
// Pre-existing behavior unchanged
bad("");
ok("{{@n1:A.b}} > 3");
// Post-replacement validation still blocks eval in the transformed expression
assert.equal(post("__v0 === 'si' && eval('1')").valid, false);
assert.equal(post("__v0 === 'si'").valid, true);
console.log("PASS condition-label-keyword");
// Unresolved refs (node output missing) are left raw by the executor; the post
// validation must still reject payloads hidden in them (fail closed).
for (const e of [
  "{{@missing:eval('1')}}",
  "{{@missing:x}} && process.exit()",
  "{{@missing:a.constructor}}",
  "{{@a:b}} === 'si' && {{@missing:require('fs')}}",
]) assert.equal(post(e).valid, false, "post must block: " + e);
// Unresolved ref with a plain label is not executable JS (syntax error -> false)
assert.throws(() => new Function(`return ({{@missing:Paso evaluar.x}} === 'si');`), SyntaxError);
// Quote-splice attempt: a ref spanning code between string pieces is NOT masked
bad("'{{@a:b' + eval(1) + '}}'");
bad("{{@a:b\"+ require('x') +\"c}} === 1");
// Malformed ref (no closing braces) is not masked: stays blocked by pre
bad("{{@n4:Evaluar umbral.result.x === 'si'");
bad("{{@n4:Paso.x}} === 'si' {{@n4:eval(1)");
// Value substitution is data only: values never reach the code string
{
  const evalContext: Record<string, unknown> = {};
  const expr = "{{@n4:Evaluar.result.x}} === 'x'".replace(
    /\{\{@([^:]+):([^}]+)\}\}/g, () => { evalContext.__v0 = "eval(1)"; return "__v0"; });
  assert.equal(post(expr).valid, true);
  assert.equal(new Function("__v0", `return (${expr});`)("x"), true);
}
console.log("PASS condition-label-keyword (extended)");

