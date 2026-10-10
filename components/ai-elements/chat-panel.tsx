"use client";
import { useAtomValue } from "jotai";
import { MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
import { edgesAtom, nodesAtom } from "@/lib/workflow-store";
type Msg = { id: string; role: "user" | "assistant"; content: string };
export function ChatPanel({ workflowId }: { workflowId: string }) {
  const { data: session } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const nodes = useAtomValue(nodesAtom);
  const edges = useAtomValue(edgesAtom);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !signedIn) return;
    let live = true;
    fetch(`/api/workflow-chat?workflowId=${encodeURIComponent(workflowId)}`, { cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); if (live) setMsgs(d.messages); })
      .catch(e => live && setError(e instanceof Error ? e.message : "Could not load the conversation."));
    return () => { live = false; };
  }, [open, signedIn, workflowId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy, open]);
  async function send() {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true); setError("");
    const snapshot = {
      nodes: nodes.filter(n => n.type !== "add").map(n => ({ id: n.id, label: n.data?.label, type: n.data?.type, action: (n.data?.config as { actionType?: string; triggerType?: string } | undefined)?.actionType || (n.data?.config as { triggerType?: string } | undefined)?.triggerType })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
    };
    try {
      const r = await fetch("/api/workflow-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId, message: t, snapshot }), signal: AbortSignal.timeout(65000) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Request failed.");
      setMsgs(m => [...m, { id: `u${Date.now()}`, role: "user", content: t }, { id: `a${Date.now()}`, role: "assistant", content: d.reply }]);
      setText("");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Your message is still in the box."); } finally { setBusy(false); }
  }
  if (!open) return <Button aria-label="Open chat" className="pointer-events-auto absolute left-4 top-16 z-10 gap-2 shadow-lg" onClick={() => setOpen(true)} size="sm"><MessageSquare className="size-4" />Chat</Button>;
  return <aside aria-label="Workflow chat" className="pointer-events-auto absolute bottom-20 left-4 top-16 z-10 flex w-[22rem] max-w-[calc(100%-2rem)] flex-col rounded-lg border bg-background shadow-lg">
    <div className="flex items-center justify-between border-b px-3 py-2"><p className="text-sm font-semibold">Chat</p><button aria-label="Close chat" className="rounded p-1 hover:bg-muted" onClick={() => setOpen(false)}><X className="size-4" /></button></div>
    {!signedIn ? <div className="space-y-3 p-4"><p className="text-sm font-semibold">Sign in to chat.</p><p className="text-xs text-muted-foreground">Your conversation is saved with this workflow, so it needs your account.</p><AuthDialog><Button size="sm">Sign In</Button></AuthDialog></div> : <>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-sm">
        {msgs.length === 0 && !busy && <p className="text-muted-foreground">Tell me what you want to automate, or ask me anything about this board. For now I can talk it through with you; building on the canvas is coming next.</p>}
        {msgs.map(m => <div key={m.id} className={m.role === "user" ? "text-right" : ""}><div className={"inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left " + (m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>{m.content}</div></div>)}
        {busy && <p className="animate-pulse text-xs text-muted-foreground">Thinking...</p>}
        {error && <p role="alert" className="rounded-lg border border-destructive p-2 text-xs text-destructive">{error}</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t p-2" onSubmit={e => { e.preventDefault(); void send(); }}>
        <textarea aria-label="Message" className="max-h-28 min-h-9 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm" rows={1} maxLength={2000} value={text} placeholder="Ask or describe what you want..." onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <Button size="sm" type="submit" disabled={busy || !text.trim()}>Send</Button>
      </form>
    </>}
  </aside>;
}
