import "server-only";

/**
 * Source contracts: when the user's request references an EXISTING data source
 * (today: a Google Sheet by URL or id), read its real schema server-side before
 * the builder generates, so the workflow wires against verified column names
 * instead of the model's guesses. Any failure returns no contract and the
 * builder proceeds as before - inspection never blocks generation.
 */

export type SheetContract = {
  kind: "googlesheets";
  spreadsheetId: string;
  spreadsheetTitle?: string;
  sheets: Array<{ title: string; columns: string[] }>;
};

export type ApiSampleContract = {
  kind: "api-sample";
  sample: unknown;
  paths: string[];
};

export type SourceContract = SheetContract | ApiSampleContract;

const BASE = "https://backend.composio.dev/api/v3";
type Row = Record<string, unknown>;

async function composioRequest(path: string, body?: Row): Promise<Row> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("no key");
  const r = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json() as Promise<Row>;
}

const SHEET_URL_RE = /spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/g;
const PLACEHOLDER_ID = /example|placeholder|xxx|tu[-_]planilla|<.*>/i;

/** Spreadsheet ids mentioned in the prompt (URLs or explicit spreadsheet_id values). */
export function extractSpreadsheetIds(promptText: string): string[] {
  const ids = new Set<string>();
  for (const m of promptText.matchAll(SHEET_URL_RE)) ids.add(m[1]);
  for (const m of promptText.matchAll(/spreadsheet_id["'\s:=]+["']([a-zA-Z0-9-_]{10,})["']/g)) ids.add(m[1]);
  return [...ids].filter((id) => !PLACEHOLDER_ID.test(id)).slice(0, 2);
}

/** Flatten a JSON sample into dotted paths (arrays use the first item's shape). */
export function samplePaths(sample: unknown, prefix = "", depth = 0): string[] {
  if (depth > 4 || sample === null || typeof sample !== "object") return [];
  const out: string[] = [];
  const entries = Array.isArray(sample)
    ? Object.entries((sample[0] ?? {}) as Record<string, unknown>)
    : Object.entries(sample as Record<string, unknown>);
  for (const [k, v] of entries) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    if (v && typeof v === "object") out.push(...samplePaths(v, p, depth + 1));
  }
  return out;
}

const SAMPLE_LABEL = /respuesta de ejemplo|ejemplo de respuesta|sample (json|response)|as[ií] responde|responde algo como|devuelve algo como/i;

/**
 * A sample JSON the user pasted for their own API. Only attempted when the
 * prompt talks about an API/endpoint AND labels the sample as an example.
 */
export function extractApiSample(promptText: string): ApiSampleContract | null {
  if (!/api|endpoint/i.test(promptText) || !SAMPLE_LABEL.test(promptText)) return null;
  const fenced = promptText.match(/```(?:json)?\s*([\s\S]{10,4000}?)```/);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  // Raw object/array right after the label.
  const labelMatch = promptText.match(SAMPLE_LABEL);
  if (labelMatch) {
    const after = promptText.slice((labelMatch.index ?? 0) + labelMatch[0].length, (labelMatch.index ?? 0) + labelMatch[0].length + 4200);
    const start = after.search(/[{[]/);
    if (start >= 0) candidates.push(after.slice(start));
  }
  for (const cand of candidates) {
    const trimmed = cand.trim();
    for (const end of [trimmed.length, ...balancePoints(trimmed)]) {
      try {
        const sample = JSON.parse(trimmed.slice(0, end));
        if (sample && typeof sample === "object") {
          const paths = samplePaths(sample);
          if (paths.length >= 2) return { kind: "api-sample", sample, paths };
        }
      } catch { /* keep trying */ }
    }
  }
  return null;
}

/** Indexes where a JSON document starting at 0 can validly end (balanced braces). */
function balancePoints(text: string): number[] {
  const points: number[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) points.push(i + 1);
    }
  }
  return points;
}

function firstRowOf(data: unknown): string[] | null {
  // Defensive: find the first array-of-arrays-of-scalars anywhere in the response.
  const visit = (v: unknown, depth: number): string[] | null => {
    if (depth > 4 || v === null || typeof v !== "object") return null;
    if (Array.isArray(v)) {
      if (v.length && Array.isArray(v[0]) && (v[0] as unknown[]).every((c) => c === null || typeof c !== "object")) {
        return (v[0] as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean);
      }
      for (const item of v) { const r = visit(item, depth + 1); if (r) return r; }
      return null;
    }
    for (const val of Object.values(v as Row)) { const r = visit(val, depth + 1); if (r) return r; }
    return null;
  };
  return visit(data, 0);
}

function sheetTitles(data: unknown): Array<{ title: string; spreadsheetTitle?: string }> {
  const out: Array<{ title: string; spreadsheetTitle?: string }> = [];
  let spreadsheetTitle: string | undefined;
  const visit = (v: unknown, depth: number): void => {
    if (depth > 3 || v === null || typeof v !== "object" || Array.isArray(v)) return;
    const obj = v as Row;
    if (typeof obj.title === "string" && !spreadsheetTitle) spreadsheetTitle = obj.title;
    if (Array.isArray(obj.sheets)) {
      for (const s of obj.sheets as Row[]) {
        const t = (s?.properties as Row)?.title ?? s?.title ?? s?.name;
        if (typeof t === "string") out.push({ title: t });
      }
    }
    for (const val of Object.values(obj)) visit(val, depth + 1);
  };
  visit(data, 0);
  return out.map((s) => ({ ...s, spreadsheetTitle }));
}

/**
 * Read the real schema of Google Sheets referenced in the prompt, using the
 * user's own ACTIVE Composio googlesheets connection. Empty on any failure.
 */
export async function inspectSheetsContracts(promptText: string, userId: string): Promise<SheetContract[]> {
  const ids = extractSpreadsheetIds(promptText);
  if (!ids.length) return [];
  try {
    const accounts = await composioRequest(`/connected_accounts?${new URLSearchParams({ user_ids: userId, toolkit_slugs: "googlesheets", statuses: "ACTIVE", limit: "5" })}`);
    const mine = ((accounts.items ?? []) as Row[]).filter((a) => a.user_id === userId && a.status === "ACTIVE" && !a.is_disabled);
    if (!mine.length) return [];
    const accountId = String(mine[0].id);
    const contracts: SheetContract[] = [];
    for (const spreadsheetId of ids) {
      try {
        const info = await composioRequest(`/tools/execute/GOOGLESHEETS_GET_SPREADSHEET_INFO`, { user_id: userId, connected_account_id: accountId, arguments: { spreadsheet_id: spreadsheetId } });
        const data = (info.data ?? info) as unknown;
        const titles = sheetTitles(data);
        if (!titles.length) continue;
        const first = titles[0].title;
        const values = await composioRequest(`/tools/execute/GOOGLESHEETS_BATCH_GET`, { user_id: userId, connected_account_id: accountId, arguments: { spreadsheet_id: spreadsheetId, ranges: [`${first}!A1:Z1`] } });
        const columns = firstRowOf((values.data ?? values) as unknown) ?? [];
        contracts.push({ kind: "googlesheets", spreadsheetId, spreadsheetTitle: titles[0].spreadsheetTitle, sheets: titles.map((t, i) => ({ title: t.title, columns: i === 0 ? columns : [] })) });
      } catch (error) {
        console.info("[source-inspector] sheet inspection failed", spreadsheetId, error instanceof Error ? error.message : "unknown");
      }
    }
    return contracts;
  } catch (error) {
    console.info("[source-inspector] unavailable", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

/** Prompt block the builder sees. Verified facts, not suggestions. */
export function contractPromptBlock(contracts: SourceContract[]): string {
  const parts: string[] = [];
  for (const c of contracts) {
    if (c.kind === "googlesheets") {
      for (const s of c.sheets) {
        if (!s.columns.length) continue;
        parts.push(`- Google Sheet ${c.spreadsheetTitle ? `"${c.spreadsheetTitle}" ` : ""}(spreadsheet_id "${c.spreadsheetId}"), sheet "${s.title}": VERIFIED exact columns in order: ${s.columns.map((col, i) => `${String.fromCharCode(65 + i)}="${col}"`).join(", ")}. Use these exact column names and this order when writing rows; never invent or rename columns, and use sheet_name "${s.title}" exactly.`);
      }
    } else {
      parts.push(`- The user's own API returns JSON with EXACTLY these fields: ${c.paths.join(", ")}. On the HTTP Request node that calls it, set config.responseSchema to the sample JSON the user pasted, and reference only these fields under its .data output.`);
    }
  }
  return parts.length
    ? `\nVERIFIED SOURCE CONTRACTS (read live from the user's actual sources; these override any assumption):\n${parts.join("\n")}\n`
    : "";
}
