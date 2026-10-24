import { createGoogleGenerativeAI } from "@ai-sdk/google"; const { judgeStanding } = await import("../../lib/agent/objective");
const key = process.env.GEMINI_API_KEY!; const model = createGoogleGenerativeAI({ apiKey: key })("gemini-3.5-flash-lite");
const cases: [string, string[], string, string][] = [
 ["explicit withdrawal", ["Quiero crear 3 videos para publicidad con mis productos", "Mejor sin videos, solo los guiones"], "video", "withdrawn"],
 ["substitution", ["Generá videos de mis productos", "En vez de videos, hacé imágenes"], "video", "withdrawn"],
 ["provider change (still wanted)", ["Quiero crear un video por producto", "Usá otro proveedor para el video, no fal"], "video", "wanted"],
 ["cost question (not withdrawal)", ["Quiero crear 3 videos por día", "¿y los videos salen caros? contame"], "video", "wanted"],
 ["withdrawal reversed", ["Crear videos de mis productos", "Sacá los videos", "Pensándolo mejor, sí quiero los videos"], "video", "wanted"],
 ["ambiguous", ["Quiero crear videos para mis productos", "no sé si los videos valen la pena"], "video", "unclear"],
];
let bad = 0;
for (const [name, msgs, kind, want] of cases) { const r = await judgeStanding(model as any, msgs, [kind]); const ok = r[kind] === want; if (!ok) bad++; console.log(ok ? "OK  " : "DIFF", name, "->", r[kind], "(expected", want + ")"); }
console.log("diffs:", bad, "of", cases.length);
