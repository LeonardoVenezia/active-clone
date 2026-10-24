// Deterministic check of which steps still hold placeholder values (shared by the chat client and the unified agent).
export function findPlaceholders(nodes: { id: string; data?: unknown }[]): string[] {
  const bad = /(?:^|\/\/)(?:your|tu|my|mi)[\s_-]|^<[^>]*>$|^\[[^\]]*\]$|^\{\{?[^}]*\}?\}$|example\.com|placeholder|replace[_\s-]?me|change[_\s-]?me|^todo$|^xxx+$|spreadsheet[_-]?id$|^1abc|^abc123|your_|\[\[|<[a-z_ ]{2,30}>/i;
  const out: string[] = [];
  for (const n of nodes) {
    const d = (n.data ?? {}) as { label?: string; type?: string; config?: Record<string, unknown> };
    const cfg = d.config ?? {};
    let args: Record<string, unknown> = {};
    const raw = cfg.arguments ?? cfg.actionArguments;
    if (typeof raw === "string") { try { args = JSON.parse(raw); } catch { /* ignore */ } } else if (raw && typeof raw === "object") args = raw as Record<string, unknown>;
    const scan: Record<string, unknown> = { ...args };
    for (const [k, v] of Object.entries(cfg)) if (!["arguments", "actionArguments", "actionType", "triggerType", "toolkit", "slug", "integrationId", "condition"].includes(k) && typeof v === "string") scan[k] = v;
    const validTemplate = /^\s*\{\{@[^}]+\}\}\s*$/;
  for (const [k, v] of Object.entries(scan)) if (typeof v === "string" && bad.test(v) && !validTemplate.test(v)) out.push(`${d.label ?? "paso"}: ${k}`);
  }
  return out.slice(0, 5);
}
