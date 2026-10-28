// Offline (no network): the paid route is reachable only through ai=ds + explicit QA user id + QA_ALLOW_PAID; never from automatic chains on Preview.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../../evals/semantic/stubs/server-only.ts");
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: any[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
const { llmRoutes } = await import("../../lib/free-models"); const { selectRoutes } = await import("../../lib/model-select");
const set = (e: Record<string, string | undefined>) => { for (const k of ["VERCEL_ENV", "REFUSELESS_API_KEY", "GEMINI_API_KEY", "QA_AI_USER_IDS", "QA_ALLOW_PAID", "AI_DS_OPEN"]) { if (e[k] === undefined) delete process.env[k]; else process.env[k] = e[k]; } };
const names = (rs: any[]) => rs.map(x => x.name).join(",");
const res: [string, boolean][] = [];
const base = { REFUSELESS_API_KEY: "k-test", GEMINI_API_KEY: "g-test" };
set({ ...base, VERCEL_ENV: "preview", QA_AI_USER_IDS: "qa1", QA_ALLOW_PAID: "1" });
res.push(["preview auto chain has no refuseless", !names(llmRoutes()).includes("refuseless")]);
res.push(["preview selector auto (QA user, paid enabled) has no refuseless", !names((selectRoutes(undefined, "qa1") as any).routes).includes("refuseless")]);
res.push(["preview selector 'auto' string has no refuseless", !names((selectRoutes("auto", "qa1") as any).routes).includes("refuseless")]);
const ds = selectRoutes("ds", "qa1") as any; res.push(["ds + explicit QA id + enabled -> only refuseless, strict", ds.ok && names(ds.routes) === "refuseless" && ds.strict === true]);
res.push(["ds + other user -> 403", (selectRoutes("ds", "other") as any).status === 403]);
set({ ...base, VERCEL_ENV: "preview", QA_AI_USER_IDS: "*", QA_ALLOW_PAID: "1" }); res.push(["ds + wildcard -> 403", (selectRoutes("ds", "anyone") as any).status === 403]);
set({ ...base, VERCEL_ENV: "preview", QA_AI_USER_IDS: "qa1" }); res.push(["ds without QA_ALLOW_PAID -> 403", (selectRoutes("ds", "qa1") as any).status === 403]);
set({ ...base, VERCEL_ENV: "preview", QA_AI_USER_IDS: "qa1", QA_ALLOW_PAID: "1" }); res.push(["g selector never includes refuseless", names((selectRoutes("g", "qa1") as any).routes) === "gemini"]);
set({ ...base, VERCEL_ENV: "production" }); res.push(["production auto chain unchanged (refuseless last)", names(llmRoutes()).endsWith("refuseless")]);
set({ ...base, VERCEL_ENV: "production", QA_AI_USER_IDS: "qa1", QA_ALLOW_PAID: "1" }); res.push(["production ds still gated by explicit QA id", (selectRoutes("ds", "other") as any).status === 403]);
set({ ...base, VERCEL_ENV: "production", QA_AI_USER_IDS: "qa1", QA_ALLOW_PAID: "1", AI_DS_OPEN: "1" }); { const d = selectRoutes("ds", "other") as any; res.push(["AI_DS_OPEN: ds for any signed-in user -> only refuseless, strict", d.ok && names(d.routes) === "refuseless" && d.strict === true]); }
res.push(["AI_DS_OPEN does not open ai=g to other users", (selectRoutes("g", "other") as any).status === 403]);
res.push(["AI_DS_OPEN without a user id -> 403", (selectRoutes("ds", "") as any).status === 403]);
res.push(["AI_DS_OPEN: auto chain unchanged for other users", names((selectRoutes(undefined, "other") as any).routes) === names(llmRoutes())]);
set({ ...base, VERCEL_ENV: "production", QA_AI_USER_IDS: "qa1", AI_DS_OPEN: "1" }); res.push(["AI_DS_OPEN without QA_ALLOW_PAID -> 403", (selectRoutes("ds", "other") as any).status === 403]);
set({ ...base, VERCEL_ENV: "production", QA_AI_USER_IDS: "qa1", QA_ALLOW_PAID: "1" }); res.push(["ds without AI_DS_OPEN stays gated", (selectRoutes("ds", "other") as any).status === 403]);
for (const [n, ok] of res) console.log(ok ? "PASS" : "FAIL", n);
console.log(res.every(x => x[1]) ? "ALL PASS" : "SOME FAIL");
