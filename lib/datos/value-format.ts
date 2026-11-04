// Tag that ties a "json" format flag to the exact text the builder serialized. If the text is edited later (editor, API) the tag no longer matches
// and the step silently falls back to the legacy behaviour, so a stale flag can never apply to text it was not written for.
export function jsonFormatTag(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `json:${text.length}:${h.toString(16)}`;
}
