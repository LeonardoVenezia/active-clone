// Plain-language list of what is still pending after a partial build, built from the validator's own messages. Deterministic, so
// the user sees it even when the guide pass writes nothing or fails. Names steps by the label shown on the canvas, never fields.
const REASONS: [RegExp, string][] = [
  [/is not connected from the trigger/, "no está unido al resto del flujo, así que no se va a ejecutar"],
  [/no path runs from/, "usa datos de un paso que no se ejecuta antes que él"],
  [/raw list field/, "recibe una lista entera de datos donde se espera un solo valor"],
  [/^configuración: "[^"]*" sets \S+, which .* does not read/, "tiene un ajuste que esa acción no usa"],
  [/which is not a date/, "tiene una fecha que no es válida"],
];

export function pendingForUser(errs: string[]): string {
  const byStep = new Map<string, Set<string>>(); let general = false;
  for (const e of errs) {
    const m = /node "([^"]+)" \(([^)]*)\)/.exec(e) ?? /^configuración: "([^"]+)"/.exec(e);
    if (!m) { general = true; continue; }
    const label = m[2] || m[1];
    const self = new RegExp(`references "${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" but no path`).test(e);
    const reason = self ? "usa su propio resultado, que todavía no existe cuando se ejecuta" : REASONS.find(([re]) => re.test(e))?.[1] ?? "quedó con un problema que no pude corregir";
    if (!byStep.has(label)) byStep.set(label, new Set());
    byStep.get(label)?.add(reason);
  }
  const lines = [...byStep].slice(0, 6).map(([label, rs]) => `- «${label}»: ${[...rs].join("; ")}.`);
  if (byStep.size > 6) lines.push(`- Y ${byStep.size - 6} paso${byStep.size - 6 === 1 ? "" : "s"} más.`);
  if (general) lines.push("- El flujo todavía no incluye todo lo que pediste.");
  return lines.length ? `Qué falta:\n${lines.join("\n")}` : "";
}
