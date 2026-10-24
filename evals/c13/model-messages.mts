// Offline: toModelMessages makes tool results SDK-valid and rejects (loudly) what cannot be made valid. Real SDK schema, no model.
import { modelMessageSchema } from "ai";
const M: any = await import("../../lib/agent/model-messages"); const { toModelMessages } = M.default ?? M;
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const toolMsg = (value: unknown) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "x", output: { type: "json", value } }] });
const raw = [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "x", input: {} }] }, toolMsg({ ok: true, structure: [{ id: "a", action: undefined, schedule: undefined }] })];
t("raw message with an undefined property is rejected by the SDK schema", !modelMessageSchema.safeParse(raw[1]).success);
const fixed = toModelMessages(raw); t("sanitized messages all validate", fixed.every((m: any) => modelMessageSchema.safeParse(m).success));
t("undefined props are dropped, real values kept", JSON.stringify((fixed[1] as any).content[0].output.value) === JSON.stringify({ ok: true, structure: [{ id: "a" }] }));
let threw = ""; try { toModelMessages([{ role: "tool", content: "not an array" }]); } catch (e: any) { threw = e.message; }
t("genuinely invalid message throws, naming index and role but not content", /#0 tool/.test(threw) && !/not an array/.test(threw));
t("valid input passes unchanged", JSON.stringify(toModelMessages([{ role: "assistant", content: "hola" }])) === JSON.stringify([{ role: "assistant", content: "hola" }]));
res.forEach(([n, ok]) => console.log(ok ? "PASS" : "FAIL", n)); process.exit(res.every((r) => r[1]) ? 0 : 1);
