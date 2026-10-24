/** Allowlist code for a provider/SDK failure: never the message text. */
export function errCode(message: unknown, status: unknown): string {
  const m = String(message ?? "").toLowerCase(); const st = typeof status === "number" ? status : 0;
  if (st === 429 || /quota|rate.?limit|too many/.test(m)) return st === 429 ? "rate-or-quota-429" : "rate-or-quota";
  if (st === 503 || st === 502 || st === 504 || /overloaded|high demand|unavailable/.test(m)) return `unavailable${st ? "-" + st : ""}`;
  if (/invalid prompt|modelmessage/.test(m)) return "invalid-prompt";
  if (/abort|timeout|timed out/.test(m)) return "aborted-or-timeout";
  if (st >= 400 && st < 500) return `client-${st}`;
  if (st >= 500) return `server-${st}`;
  return "other";
}
