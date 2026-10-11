"use client";
import { useReactFlow } from "@xyflow/react";
import { useAtom } from "jotai";
import { MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { currentWorkflowNameAtom, edgesAtom, nodesAtom } from "@/lib/workflow-store";
type Msg = { id: string; role: "user" | "assistant"; content: string };
export function ChatPanel({ workflowId }: { workflowId: string }) {
  const { data: session } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [edges, setEdges] = useAtom(edgesAtom);
  const [, setName] = useAtom(currentWorkflowNameAtom);
  const { fitView } = useReactFlow();
  const [undo, setUndo] = useState<{ nodes: typeof nodes; edges: typeof edges; name?: string } | null>(null);
  const [building, setBuilding] = useState(false);
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
  // Applies the plan to the canvas the same way Ask AI does, keeps the previous state so Undo works, restores it on failure.
  async function build(instruction: string, convo: Msg[]) {
    if (building) return;
    setBuilding(true); setError("");
    const before = { nodes, edges };
    const real = nodes.filter(n => n.type !== "add");
    const existing = real.length ? { nodes: real, edges } : undefined;
    const prompt = `Conversation so far:\n${convo.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n")}\n\nWhat to do on the canvas now: ${instruction}\n\nFor any app or action not covered by another step (Slack, Notion, Airtable, Stripe, Docs, Hacker News and others) use a step with actionType "composio/run-tool" (the Run Composio Action step) and config fields toolkit (lowercase app slug), tool (UPPERCASE tool slug such as SLACK_SEND_MESSAGE) and arguments (a JSON string).`;
    try {
      const data = await api.ai.generateStream(prompt, partial => {
        const triggers = (partial.nodes || []).filter(n => n.data?.type === "trigger");
        const keep = triggers.length > 1 ? (partial.nodes || []).filter(n => n.data?.type !== "trigger" || n.id === triggers[0].id) : partial.nodes || [];
        const ids = new Set(keep.map(n => n.id));
        setNodes(keep);
        setEdges((partial.edges || []).filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e, type: "animated" })));
        if (partial.name) setName(partial.name);
      }, existing ? { nodes: real, edges, name: undefined } : undefined);
      const wasThere = new Set(real.map(n => n.id));
      const bad = (data.nodes || []).filter(n => !wasThere.has(n.id) && ((n.data?.type === "trigger" && !(n.data?.config as { triggerType?: string })?.triggerType) || (n.data?.type === "action" && !(n.data?.config as { actionType?: string })?.actionType)));
      if (bad.length) throw new Error(`I could not build that: ${bad.length} step(s) need an action this board does not have yet. Nothing was changed. Try describing it with the available actions (email, Slack, ticket, database query, HTTP request, text/image generation, scrape, search).`);
      if (!(data.nodes || []).length) throw new Error("Nothing was built. Nothing was changed. Try describing it a bit differently.");
      const finalEdges = (data.edges || []).map(e => ({ ...e, type: "animated" }));
      await api.workflow.update(workflowId, { name: data.name, description: data.description, nodes: data.nodes, edges: finalEdges });
      setUndo({ nodes: before.nodes, edges: before.edges });
      setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 0);
      toast.success("Done. You can undo it from the chat.");
    } catch (e) {
      setNodes(before.nodes); setEdges(before.edges); // restore: a failed build never leaves half a workflow
      setError(e instanceof Error ? e.message : "The build failed. Nothing was changed.");
    } finally { setBuilding(false); }
  }
  async function undoBuild() {
    if (!undo) return;
    setNodes(undo.nodes); setEdges(undo.edges);
    try { await api.workflow.update(workflowId, { nodes: undo.nodes.filter(n => n.type !== "add"), edges: undo.edges }); setUndo(null); toast.success("Undone."); }
    catch { setError("Undone on screen, but saving failed. Press Save."); }
  }
  const [card, setCard] = useState<{ toolkitId: string; title: string; grants: { label: string }[]; doesNotGrant: string[]; consentHint: string; generic?: boolean; apiKey?: boolean } | null>(null);
  const [cardNote, setCardNote] = useState("");
  const [ack, setAck] = useState(false);
  async function startConnect() {
    if (!card) return; setCardNote("");
    try {
      const r = await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: card.generic ? "connect_generic" : "connect", toolkitId: card.toolkitId, acknowledged: card.generic ? ack : undefined }) });
      const d = await r.json(); if (!r.ok || !d.redirectUrl) throw new Error(d.error || "Could not start the connection.");
      window.open(d.redirectUrl, "_blank", "noopener"); setCardNote("Finish on the new tab, then come back and press \"I connected it\".");
    } catch (e) { setCardNote(e instanceof Error ? e.message : "Could not start the connection."); }
  }
  async function checkConnected() {
    if (!card) return;
    try {
      const d = card.generic ? null : await (await fetch("/api/connectors", { cache: "no-store" })).json();
      const ok = card.generic ? (await (await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "active", toolkitId: card.toolkitId }) })).json()).active === true : (d.connections?.[card.toolkitId] ?? []).some((c: { status: string }) => c.status === "active");
      if (ok) { const t = card.title; setCard(null); setCardNote(""); setMsgs(m => [...m, { id: `a${Date.now()}`, role: "assistant", content: `Connected: ${t}. Tell me to continue.` }]); }
      else setCardNote("I don't see an active connection yet. Finish the sign-in tab and try again.");
    } catch { setCardNote("Could not check. Try again."); }
  }
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
      const next: Msg[] = [...msgs, { id: `u${Date.now()}`, role: "user", content: t }, { id: `a${Date.now()}`, role: "assistant", content: d.reply }];
      setMsgs(next);
      setText("");
      setCard(d.connect ?? null); setCardNote("");
      if (d.build) void build(d.build, next);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Your message is still in the box."); } finally { setBusy(false); }
  }
  if (!open) return <Button aria-label="Open chat" className="pointer-events-auto absolute left-4 top-16 z-10 gap-2 shadow-lg" onClick={() => setOpen(true)} size="sm"><MessageSquare className="size-4" />Chat</Button>;
  return <aside aria-label="Workflow chat" className="pointer-events-auto absolute bottom-40 left-4 top-16 z-10 flex w-[22rem] max-w-[calc(100%-2rem)] flex-col rounded-lg border bg-background shadow-lg">
    <div className="flex items-center justify-between border-b px-3 py-2"><p className="text-sm font-semibold">Chat</p><button aria-label="Close chat" className="rounded p-1 hover:bg-muted" onClick={() => setOpen(false)}><X className="size-4" /></button></div>
    {!signedIn ? <div className="space-y-3 p-4"><p className="text-sm font-semibold">Sign in to chat.</p><p className="text-xs text-muted-foreground">Your conversation is saved with this workflow, so it needs your account.</p><AuthDialog><Button size="sm">Sign In</Button></AuthDialog></div> : <>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-sm">
        {msgs.length === 0 && !busy && <p className="text-muted-foreground">Tell me what you want to automate, or ask me anything about this board. For now I can talk it through with you; building on the canvas is coming next.</p>}
        {msgs.map(m => <div key={m.id} className={m.role === "user" ? "text-right" : ""}><div className={"inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left " + (m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>{m.content}</div></div>)}
        {card && <div className="space-y-2 rounded-lg border p-3 text-xs"><p className="text-sm font-semibold">Connect: {card.title}</p>{card.generic ? <>{card.apiKey ? <p>This app uses an API key. You will paste it on a secure page of our integration provider, never in this chat. The key is stored by the provider and used only for your workflows.</p> : null}<p>This app signs in through our integration provider. Its permissions cannot be narrowed ahead of time: the app's own screen shows exactly what it asks for, and you can decline there.</p><label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>I understand and will review the permissions on the next screen.</span></label></> : <><p>This will allow:</p><ul className="list-disc pl-4">{card.grants.map(g => <li key={g.label}>{g.label}</li>)}</ul><p>It will not allow: {card.doesNotGrant.join(", ")}.</p><p className="text-muted-foreground">{card.consentHint}</p></>}<div className="flex gap-2"><Button size="sm" disabled={!!card.generic && !ack} onClick={() => void startConnect()}>Connect</Button><Button size="sm" variant="outline" onClick={() => void checkConnected()}>I connected it</Button></div>{cardNote && <p role="status">{cardNote}</p>}</div>}
        {busy && <p className="animate-pulse text-xs text-muted-foreground">Thinking...</p>}
        {building && <p role="status" className="animate-pulse text-xs text-muted-foreground">Building on the canvas...</p>}
        {undo && !building && <p className="text-xs"><button className="underline" onClick={() => void undoBuild()}>Undo last change</button></p>}
        {!building && !busy && msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && <p className="text-xs"><button className="underline text-muted-foreground" onClick={() => void build("Build or change the workflow as discussed in the conversation.", msgs)}>Build this on the canvas</button></p>}
        {error && <p role="alert" className="rounded-lg border border-destructive p-2 text-xs text-destructive">{error}</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t p-2" onSubmit={e => { e.preventDefault(); void send(); }}>
        <textarea aria-label="Message" className="max-h-28 min-h-9 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm" rows={1} maxLength={2000} value={text} placeholder="Ask or describe what you want..." onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <Button size="sm" type="submit" disabled={busy || building || !text.trim()}>Send</Button>
      </form>
    </>}
  </aside>;
}
