import assert from "node:assert/strict";
import mod from "../../lib/condition-validator.ts";
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
