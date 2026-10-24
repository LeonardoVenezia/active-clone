// Offline: the REAL ai-gateway generate-text step with a wrong-shape aiSchema. The failure happens in buildZodSchema BEFORE any network call
// (credentials are a dummy from a stub; no request is made). Confirms what the plugin does with a JSON-Schema-shaped aiSchema.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const st = (n: string) => r.resolve(`../../evals/c13/stubs/${n}.ts`);
const map: [RegExp, string][] = [[/^server-only$/, r.resolve("../../evals/semantic/stubs/server-only.ts")], [/lib\/credential-fetcher$/, st("engine-credfetch")], [/steps\/step-handler$/, st("engine-step-handler")]];
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { for (const [re, p] of map) if (re.test(q)) return p; return o.call(this, q, ...a); };
const m: any = await import("../../plugins/ai-gateway/steps/generate-text"); const { generateTextStep } = m.default ?? m;
const res: [string, boolean, string][] = []; const t = (n: string, ok: boolean, d = "") => res.push([n, ok, d]);
const jsonSchema = JSON.stringify({ type: "object", properties: { titulo: { type: "string" } }, required: ["titulo"] });
const r1: any = await generateTextStep({ integrationId: "x", aiFormat: "object", aiPrompt: "hola", aiSchema: jsonSchema });
t("JSON-Schema-shaped aiSchema fails before any network call", r1.success === false && /not iterable|is not|fields/i.test(String(r1.error)), String(r1.error).slice(0, 120));
const r2: any = await generateTextStep({ integrationId: "x", aiFormat: "object", aiPrompt: "hola", aiSchema: "not json" });
t("unparsable aiSchema fails", r2.success === false, String(r2.error).slice(0, 80));
let f = 0; for (const [k, ok, d] of res) { console.log(ok ? "PASS" : "FAIL", k, d ? `| ${d}` : ""); if (!ok) f++; } process.exit(f ? 1 : 0);
