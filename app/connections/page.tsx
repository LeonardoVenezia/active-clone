"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EmailVerification } from "./email-verification";
import { useSession } from "@/lib/auth-client";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
type Account = { id: string; status: string; alias: string; readOnly: boolean };
export default function Connections() {
  const { data: session, isPending } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await fetch("/api/composio/accounts", { cache: "no-store" }); const data = await r.json(); if (!r.ok) throw new Error(data.error); setAccounts(data.accounts); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not load connections."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { document.title = "Connections | Active-clone"; if (session?.user && !session.user.isAnonymous) void load(); }, [session?.user?.id, session?.user?.isAnonymous, load]);
  async function act(action: string, id?: string) {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/composio/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      if (action === "connect") window.location.assign(data.redirectUrl);
      else setMessage(`Read succeeded: ${data.count} message IDs returned. Nothing sent or changed.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Connection failed."); }
    finally { setBusy(false); }
  }
  return <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background p-6"><div className="mx-auto max-w-2xl space-y-6">
    <Link className="text-sm underline" href="/">Back to Active-clone</Link>
    <h1 className="text-2xl font-bold">Connections</h1>
    <EmailVerification />
    <p className="text-muted-foreground">Connect Gmail through Composio. You choose your Google account and review access on the consent screen. Composio stores the OAuth tokens. This first version requests read-only Gmail access, not sending or editing permission.</p>
    {isPending ? <p>Loading session...</p> : !session?.user || session.user.isAnonymous ? <AuthDialog><Button>Sign In</Button></AuthDialog> : <>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void act("connect")}>Connect Gmail (read-only)</Button><Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh status</Button></div>
      <p className="text-sm text-muted-foreground">After Google returns you here, refresh status. The test lists at most 5 message IDs only. It does not fetch bodies, send email or change your inbox. No background polling.</p>
      {accounts.length === 0 && <p>No Gmail connections found for this app user.</p>}
      {accounts.map(a => <section className="space-y-2 rounded-lg border p-4" key={a.id}><h2 className="font-semibold">{a.alias}</h2><p className="text-sm">{a.status} · {a.readOnly ? "Read-only scope verified" : "Scope not verified for read-only test"}</p><p className="break-all text-xs text-muted-foreground">{a.id}</p><Button variant="outline" disabled={busy || a.status !== "ACTIVE" || !a.readOnly} onClick={() => void act("test", a.id)}>Test read (5 message IDs)</Button></section>)}
    </>}
    {busy && <p role="status">Working...</p>}{message && <p role="status" className="rounded-lg border p-4">{message}</p>}
  </div></main>;
}
