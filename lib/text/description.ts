// Pure helpers (no server-only import) so they can be tested offline.

/** Per-description cap. Prompts and node outputs are not meant to carry whole catalog pages; large enough for real product copy. */
export const DESCRIPTION_MAX_CHARS = 20_000;

/** Picks a string from a localized object ({es, pt, en, ...}); null/undefined/non-object -> "". */
export function pickLocalized(value: unknown, order: string[] = ["es", "pt", "en"]): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  for (const k of order) if (typeof obj[k] === "string" && (obj[k] as string).trim()) return obj[k] as string;
  for (const v of Object.values(obj)) if (typeof v === "string" && v.trim()) return v;
  return "";
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** HTML (as Tiendanube returns it) -> readable plain text with line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const l = e.toLowerCase();
      if (l in ENTITIES) return ENTITIES[l];
      const n = l.startsWith("#x") ? Number.parseInt(l.slice(2), 16) : l.startsWith("#") ? Number.parseInt(l.slice(1), 10) : Number.NaN;
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Never cuts silently: when it cuts, says so in the text and in `truncated`. */
export function limitWithNotice(text: string, max = DESCRIPTION_MAX_CHARS): { text: string; truncated: boolean; originalLength: number } {
  if (text.length <= max) return { text, truncated: false, originalLength: text.length };
  return { text: `${text.slice(0, max).trimEnd()}\n[... descripción recortada: se muestran ${max} de ${text.length} caracteres]`, truncated: true, originalLength: text.length };
}

export function tiendanubeDescription(raw: unknown) {
  return limitWithNotice(htmlToText(pickLocalized(raw)));
}

export function mlDescription(raw: unknown) {
  const pt = raw && typeof raw === "object" ? (raw as { plain_text?: unknown }).plain_text : undefined;
  return limitWithNotice(typeof pt === "string" ? pt.replace(/[ \t]+\n/g, "\n").trim() : "");
}
