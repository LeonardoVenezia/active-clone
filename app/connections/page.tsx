"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmailVerification } from "./email-verification";
import { useSession } from "@/lib/auth-client";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
type Account = { id: string; status: string; alias: string; readOnly: boolean };
type Feedback = { kind: "success" | "error" | "info"; text: string; ids?: string[]; accountId?: string };
async function api(provider: "gmail" | "outlook", options?: RequestInit) {
  const r = await fetch(`/api/composio/accounts?provider=${provider}`, { cache: "no-store", ...options, signal: AbortSignal.timeout(60000) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Connection request failed.");
  return data;
}
function errorText(e: unknown) {
  if (e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name)) return "The request timed out. Its result is unknown; wait before trying again.";
  return e instanceof Error ? e.message : "Connection request failed.";
}
function Result({ result }: { result: Feedback }) {
  return <div role={result.kind === "error" ? "alert" : "status"} className={`space-y-2 rounded-lg border p-4 ${result.kind === "error" ? "border-destructive text-destructive" : result.kind === "success" ? "border-green-600" : ""}`}>
    <p className="font-semibold">{result.kind === "error" ? "Request failed" : result.kind === "success" ? "Read succeeded" : "Status refreshed"}</p>
    <p className="break-words text-sm">{result.text}</p>
    {result.accountId && <p className="break-all text-xs">Connection: {result.accountId}</p>}
    {result.ids && result.ids.length > 0 && <ul aria-label="Returned message IDs" className="space-y-1">{result.ids.map((id, i) => <li key={`${id}-${i}`}><code className="break-all text-xs">{id}</code></li>)}</ul>}
  </div>;
}
export default function Connections() {
  const [provider, setProvider] = useState<"gmail" | "outlook">("gmail");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("returned") === "outlook") setProvider("outlook"); }, []);
  return <ProviderConnections key={provider} provider={provider} onProviderChange={setProvider} />;
}
function ProviderConnections({ provider, onProviderChange }: { provider: "gmail" | "outlook"; onProviderChange: (p: "gmail" | "outlook") => void }) {
  const label = provider === "gmail" ? "Gmail" : "Outlook";
  const { data: session, isPending } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<Record<string, Feedback>>({});
  const load = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy("Refreshing connection status...");
    try {
      const data = await api(provider); setAccounts(data.accounts);
      const active = data.accounts.filter((a: Account) => a.status === "ACTIVE").length;
      setFeedback({ kind: "info", text: `${active} active ${label} connection(s). This checks authorization status, not whether a mailbox can be read.` });
    } catch (e) { setFeedback({ kind: "error", text: errorText(e) }); }
    finally { busyRef.current = false; setBusy(""); }
  }, [provider, label]);
  useEffect(() => { document.title = "Connections | Active-clone"; if (session?.user && !session.user.isAnonymous) void load(); }, [session?.user?.id, session?.user?.isAnonymous, load]);
  async function act(action: "connect" | "test", id?: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(action === "test" ? `Testing ${label} read for ${id}...` : `Opening ${provider === "gmail" ? "Google" : "Microsoft"} authorization...`); setFeedback(null);
    try {
      const data = await api(provider, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, provider }) });
      if (action === "connect") window.location.assign(data.redirectUrl);
      else {
        const ids = Array.isArray(data.messageIds) ? data.messageIds.filter((v: unknown): v is string => typeof v === "string").slice(0, 5) : [];
        const result: Feedback = { kind: "success", accountId: id, ids, text: `${ids.length} message ID(s) returned. ${ids.length === 0 ? "The read succeeded but no messages were returned. " : ""}No email bodies fetched. Nothing sent or changed.` };
        setFeedback(result); if (id) setResults(prev => ({ ...prev, [id]: result }));
      }
    } catch (e) {
      const result: Feedback = { kind: "error", accountId: id, text: errorText(e) };
      setFeedback(result); if (id) setResults(prev => ({ ...prev, [id]: result }));
    } finally { busyRef.current = false; setBusy(""); }
  }
  return <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background p-6"><div className="mx-auto max-w-2xl space-y-6">
    <Link className="text-sm underline" href="/">Back to Active-clone</Link>
    <h1 className="text-2xl font-bold">Connections</h1>
    <Link className="block rounded-lg border p-4 underline" href="/mail-flow">Outlook → Google Sheets flow</Link>
    <div aria-label="Mail provider" className="flex flex-wrap gap-3"><Button aria-pressed={provider === "gmail"} disabled={!!busy} variant={provider === "gmail" ? "default" : "outline"} onClick={() => onProviderChange("gmail")}>Gmail</Button><Button aria-pressed={provider === "outlook"} disabled={!!busy} variant={provider === "outlook" ? "default" : "outline"} onClick={() => onProviderChange("outlook")}>Outlook</Button><Button variant="outline" disabled={!!busy} asChild><Link href="/mail-flow">Google Sheets</Link></Button></div>
    <EmailVerification />
    <p className="text-muted-foreground">Connect {label} through Composio. You choose your {provider === "gmail" ? "Google" : "Microsoft"} account and review access on the consent screen. Composio stores the OAuth tokens. This connection requests read-only mail access, not sending or editing permission.</p>
    {isPending ? <p>Loading session...</p> : !session?.user || session.user.isAnonymous ? <AuthDialog><Button>Sign In</Button></AuthDialog> : <>
      <div className="flex flex-wrap gap-3"><Button disabled={!!busy} onClick={() => void act("connect")}>Connect {label} (read-only)</Button><Button variant="outline" disabled={!!busy} onClick={() => void load()}>Refresh status</Button></div>
      {busy && <p role="status" className="break-words rounded-lg border p-4">{busy}</p>}
      {feedback && <Result result={feedback} />}
      <p className="text-sm text-muted-foreground">{provider === "gmail" ? "A Google account using an Outlook email is not necessarily a Gmail mailbox. This connection reads Gmail, not Microsoft Outlook." : "Outlook uses Microsoft OAuth to read your Microsoft mailbox. Requested permissions: Mail.Read, User.Read (identity), offline_access (keep the connection). No send, edit, calendar or contacts access."} The test returns at most 5 message IDs only, never bodies. Results appear here and beside the tested connection; they reset on page reload. No background polling.</p>
      {accounts.length === 0 && !busy && <p>No {label} connections found for this app user.</p>}
      {accounts.map(a => <section className="space-y-2 rounded-lg border p-4" key={a.id}><h2 className="font-semibold">{a.alias}</h2><p className="text-sm">{a.status} · {a.readOnly ? "Read-only scope verified" : "Scope not verified for read-only test"}</p><p className="break-all text-xs text-muted-foreground">{a.id}</p><Button variant="outline" disabled={!!busy || a.status !== "ACTIVE" || !a.readOnly} onClick={() => void act("test", a.id)}>Test read (5 message IDs)</Button>{results[a.id] && <Result result={results[a.id]} />}</section>)}
    </>}
  </div></main>;
}
