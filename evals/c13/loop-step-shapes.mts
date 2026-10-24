// Offline: Loop items[].steps.<id> for FLAT plugins ({success,text}) and WRAPPED plugins ({success,data:{...}}, e.g. fal), through the real
// exposeStepOutput + real template resolver + real JSONata (the Formula engine). Simulation of the engine's shapes, not an execution.
import jsonata from "jsonata";
const a: any = await import("../../lib/loop-output"); const { exposeStepOutput } = a.default ?? a;
const b: any = await import("../../lib/field-path"); const { resolveFieldValue } = b.default ?? b;
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const flat = { success: true, text: "t" }, wrapped = { success: true, data: { videoUrl: "v", n: 1 } };
const entry = { index: 0, item: { angulo: "A" }, steps: { guion: exposeStepOutput(flat), video: exposeStepOutput(wrapped) } };
t("flat unchanged (same object)", exposeStepOutput(flat) === flat);
t("template flat steps.guion.text", resolveFieldValue(entry, "steps.guion.text") === "t");
t("template wrapped steps.video.videoUrl (was undefined)", resolveFieldValue(entry, "steps.video.videoUrl") === "v");
t("template wrapped steps.video.data.videoUrl still works", resolveFieldValue(entry, "steps.video.data.videoUrl") === "v");
t("success kept", resolveFieldValue(entry, "steps.video.success") === true);
const e2 = jsonata('$join($map(items, function($i){ $i.item.angulo & " -> " & $i.steps.video.videoUrl }), ",")');
t("JSONata flat access on wrapped", (await e2.evaluate({ items: [entry] })) === "A -> v");
const e3 = jsonata('$i.steps.video.data.videoUrl'.replace("$i", "items[0]"));
t("JSONata .data access still works", (await e3.evaluate({ items: [entry] })) === "v");
t("data with own success/data keys: envelope wins", (() => { const o: any = exposeStepOutput({ success: true, data: { success: false, data: 5, x: 1 } }); return o.success === true && o.data === undefined ? false : o.success === true && typeof o.data === "object" && o.x === 1; })());
t("failed/array/null untouched", exposeStepOutput(null) === null && JSON.stringify(exposeStepOutput({ success: false, error: "e" })) === '{"success":false,"error":"e"}');
t("non-object data untouched", JSON.stringify(exposeStepOutput({ success: true, data: [1] })) === '{"success":true,"data":[1]}');
let f = 0; for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
