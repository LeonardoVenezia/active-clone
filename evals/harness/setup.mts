// Shared bootstrap for harness scripts, same as evals/c13/*: stub "server-only", dummy auth/db env (nothing connects), load the plugin registry.
import Module from "node:module"; import { createRequire } from "node:module";
const r = createRequire(import.meta.url); const stub = r.resolve("../semantic/stubs/server-only.ts");
// biome-ignore lint/suspicious/noExplicitAny: patching Node's resolver
const o = (Module as any)._resolveFilename; (Module as any)._resolveFilename = function (q: string, ...a: unknown[]) { return q === "server-only" ? stub : o.call(this, q, ...a); };
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x"; process.env.BETTER_AUTH_SECRET ??= "x".repeat(32); process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
await import("../../plugins");
