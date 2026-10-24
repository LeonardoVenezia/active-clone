// Offline: nested Loop / Formula reference shapes resolved with the real resolver (lib/field-path), on shapes built like the executor builds them.
const m: any = await import("../../lib/field-path"); const { resolveFieldValue } = m.default ?? m;
const res: [string, boolean][] = []; const t = (n: string, ok: boolean) => res.push([n, ok]);
const formulaData = { success: true, result: [{ numero: 1, producto: "X" }, { numero: 2, producto: "X" }] };
t("formula whole list via .result", Array.isArray(resolveFieldValue(formulaData, "result")));
t("formula .result.result does NOT resolve", resolveFieldValue(formulaData, "result.result") === undefined);
t("formula element field via index", resolveFieldValue(formulaData, "result[1].numero") === 2);
// loop 1 body: item = formula element; inner step output referenced by id (itemOutputs[stepId].data = bodyResult)
const item1 = formulaData.result[0];
t("@item:Item.numero (loop over formula list)", resolveFieldValue(item1, "numero") === 1);
const guion = { success: true, text: "gancho" }; const imagen = { success: true, imageUrl: "u" };
t("@guion:Guion.text (inner step by id)", resolveFieldValue(guion, "text") === "gancho");
t("@imagen:Imagen.imageUrl", resolveFieldValue(imagen, "imageUrl") === "u");
// loop 1 output
const loopData = { results: [{ videoUrl: "v1" }], items: [{ index: 0, item: item1, steps: { guion, imagen, video: { success: true, videoUrl: "v1" } } }], failed: [], count: 1, completed: 1 };
t("@loop:L.items resolves to list", Array.isArray(resolveFieldValue(loopData, "items")));
// loop 2 body: item = loop item entry
const entry = loopData.items[0];
t("@item:Item.item.numero (nested)", resolveFieldValue(entry, "item.numero") === 1);
t("@item:Item.steps.guion.text (nested)", resolveFieldValue(entry, "steps.guion.text") === "gancho");
t("@item:Item.steps.video.videoUrl (nested)", resolveFieldValue(entry, "steps.video.videoUrl") === "v1");
t("wrong nested guess steps.video.url -> undefined", resolveFieldValue(entry, "steps.video.url") === undefined);
t("standard {success,data} output unwraps", resolveFieldValue({ success: true, data: { a: 1 } }, "a") === 1);
let f = 0; for (const [k, ok] of res) { console.log(ok ? "PASS" : "FAIL", k); if (!ok) f++; } console.log(`${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
