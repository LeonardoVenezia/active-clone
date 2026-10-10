"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
type CardData = { toolkitId: string; title: string; grants: string[]; doesNotGrant: string[]; consentHint: string; connected: boolean; connectionId: string | null };
type Msg = { role: "user" | "assistant"; content: string; cards?: CardData[] };
async function api(path: string, body?: unknown) {
  const r = await fetch(path, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}
// Inline connect card: Activate opens the provider's consent in a popup, then the card verifies what was granted.
function ConnectCard({ card }: { card: CardData }) {
  const [state, setState] = useState<"idle" | "waiting" | "verifying" | "done" | "fix">(card.connected ? "done" : "idle");
  const [note, setNote] = useState("");
  const popup = useRef<Window | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  async function activate() {
    setNote("");
    try {
      const d = await api("/api/connectors", { action: "connect", toolkitId: card.toolkitId });
      if (!d.redirectUrl) throw new Error("No sign-in link was returned.");
      popup.current = window.open(d.redirectUrl, "connect", "width=520,height=720");
      if (!popup.current) { window.location.assign(d.redirectUrl); return; }
      setState("waiting");
      const started = Date.now();
      timer.current = setInterval(async () => {
        if (Date.now() - started > 5 * 60_000) { clearInterval(timer.current!); setState("idle"); setNote("That took too long. Press Activate to try again."); return; }
        try {
          const list = await api("/api/connectors");
          const conn = (list.connections?.[card.toolkitId] || []).find((c: { id: string; status: string }) => c.status === "active" || c.status === "needs_attention");
          if (!conn) return;
          clearInterval(timer.current!); popup.current?.close(); setState("verifying");
          const v = await api("/api/connectors", { action: "verify", toolkitId: card.toolkitId, connectionId: conn.id });
          if (v.ok) setState("done");
          else { setState("fix"); setNote(`${card.title} connected, but not with the permissions needed. ${card.consentHint}`); }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e) { setState("idle"); setNote(e instanceof Error ? e.message : "Could not start the connection."); }
  }
  return <div className="mt-2 rounded-xl border p-4 space-y-2 bg-background">
    <p className="font-semibold">{card.title}</p>
    {state === "done" ? <p className="text-sm text-green-700">Connected and checked.</p> : <>
      <ul className="text-sm list-disc pl-5">{card.grants.map(g => <li key={g}>{g}</li>)}</ul>
      {card.doesNotGrant.length > 0 && <p className="text-xs text-muted-foreground">Does not allow: {card.doesNotGrant.join("; ")}</p>}
      <Button disabled={state === "waiting" || state === "verifying"} onClick={() => void activate()}>{state === "waiting" ? "Waiting for you to approve..." : state === "verifying" ? "Checking permissions..." : state === "fix" ? "Reconnect" : "Activate"}</Button>
    </>}
    {note && <p role="alert" className="text-sm text-destructive">{note}</p>}
  </div>;
}
export default function Chat() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { document.title = "Chat | Active-clone"; }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  async function send() {
    const t = text.trim(); if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setText(""); setBusy(true); setError("");
    try {
      const d = await api("/api/chat", { messages: next.map(m => ({ role: m.role, content: m.content })) });
      setMsgs([...next, { role: "assistant", content: d.reply, cards: d.cards }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }
  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background">
    <div className="mx-auto flex w-full max-w-2xl items-center justify-between p-4"><h1 className="text-xl font-bold">Chat</h1><div className="flex gap-4 text-sm"><Link className="underline" href="/flows">Flows</Link><Link className="underline" href="/connections">Connections</Link><Link className="underline" href="/">Editor</Link></div></div>
    {isPending ? <p className="p-6">Loading...</p> : !signedIn ? <div className="mx-auto max-w-2xl p-6 space-y-3"><p className="font-semibold">Sign in to chat.</p><p className="text-sm text-muted-foreground">Your conversations and connections are saved to your account.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-auto p-4">
        {msgs.length === 0 && <p className="text-muted-foreground">Ask for what you want, like "read my email" or "add my emails to a sheet". If I need an app, I will show a button to connect it right here.</p>}
        {msgs.map((m, i) => <div key={i} className={m.role === "user" ? "text-right" : ""}><div className={"inline-block max-w-[85%] rounded-2xl px-4 py-2 text-left whitespace-pre-wrap " + (m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>{m.content}</div>{m.cards?.map(c => <ConnectCard key={c.toolkitId + i} card={c} />)}</div>)}
        {busy && <p className="text-sm text-muted-foreground animate-pulse">Thinking...</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div ref={end} />
      </div>
      <form className="mx-auto flex w-full max-w-2xl gap-2 p-4" onSubmit={e => { e.preventDefault(); void send(); }}><input className="flex-1 rounded-lg border px-3 py-2 bg-background" value={text} onChange={e => setText(e.target.value)} placeholder="Ask for something..." maxLength={2000} /><Button type="submit" disabled={busy || !text.trim()}>Send</Button></form>
    </>}
  </main>;
}
