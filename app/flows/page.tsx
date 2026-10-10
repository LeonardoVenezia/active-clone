"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/auth/dialog";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api-client";
type Row = { id: string; name: string; href: string; kind: string; status?: string };
export default function FlowsPage() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "Flows | Active-clone";
    if (!signedIn) { setRows([]); return; }
    (async () => {
      try {
        const out: Row[] = [];
        const r = await fetch("/api/flows", { cache: "no-store" });
        const d = await r.json();
        if (r.ok) for (const f of d.flows) out.push({ id: f.id, name: f.name, href: `/flows/${f.id}`, kind: "Email to sheet", status: f.status });
        const ws = await api.workflow.getAll();
        for (const w of ws.filter((w: { name: string }) => w.name !== "__current__")) out.push({ id: w.id, name: w.name, href: `/workflows/${w.id}`, kind: "Canvas workflow" });
        setRows(out);
      } catch { setError("Could not load your flows. Refresh to try again."); setRows([]); }
    })();
  }, [signedIn]);
  return <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background p-6"><div className="mx-auto max-w-3xl space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Flows</h1><div className="flex gap-3"><Link className="underline self-center text-sm" href="/connections">Connections</Link><Link className="underline self-center text-sm" href="/history">History</Link><Link className="underline self-center text-sm" href="/">Editor</Link></div></div>
    {isPending ? <p>Loading...</p> : !signedIn ? <div className="rounded-xl border p-5 space-y-3"><p className="font-semibold">Sign in to see and create flows.</p><p className="text-sm text-muted-foreground">Flows are saved to your account, so creating or running one needs you to be signed in.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {rows === null && <p>Loading flows...</p>}
      {rows?.length === 0 && !error && <p>No flows yet. <Link className="underline" href="/">Create one in the editor.</Link></p>}
      <ul className="space-y-3">{rows?.map(r => <li key={r.kind + r.id}><Link href={r.href} className="block rounded-xl border p-4 hover:border-primary"><p className="font-semibold">{r.name}</p><p className="text-sm text-muted-foreground">{r.kind}{r.status ? ` · ${r.status}` : ""} · ID {r.id}</p></Link></li>)}</ul>
    </>}
  </div></main>;
}
