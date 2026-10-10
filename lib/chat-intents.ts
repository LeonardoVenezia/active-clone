// Phase 1: rule-based detection of which app a chat message needs. No model decides this.
const RULES: { toolkitId: string; test: RegExp }[] = [
  { toolkitId: "gmail", test: /\bgmail\b/i },
  { toolkitId: "outlook", test: /\b(outlook|hotmail)\b|\b(e-?mails?|mails?|correos?|inbox|bandeja)\b/i },
  { toolkitId: "googlesheets", test: /\b(sheets?|spreadsheets?|planillas?|excel)\b|hojas? de c[aá]lculo/i },
];
export function neededToolkits(text: string): string[] {
  const hits = RULES.filter(r => r.test.test(text)).map(r => r.toolkitId);
  if (hits.includes("gmail")) return hits.filter(h => h !== "outlook").slice(0, 2); // an explicit "gmail" wins over generic mail words
  return hits.slice(0, 2);
}
