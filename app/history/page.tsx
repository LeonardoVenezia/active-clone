"use client";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { EmailVerification } from "../connections/email-verification";
import { useSession } from "@/lib/auth-client";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
type Run = { message_id: string; row_number: number; status: string; error: string | null; updated_at: string };
const LABEL: Record<string, string> = { success: "Saved to sheet", error: "Failed", running: "Saving...", pending: "Waiting" };
export default function History() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    document.title = "History | Active-clone";
    if (!signedIn) return;
    fetch("/api/mail-flow", { cache: "no-store" }).then(r => r.ok ? r.json() : { runs: [] }).then(d => setRuns(d.runs || [])).catch(() => setRuns([]));
  }, [signedIn]);
  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background"><AppHeader /><div className="flex-1 overflow-auto p-6"><div className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold">History</h1>
    {isPending ? <p>Loading...</p> : !signedIn ? <div className="rounded-xl border p-5 space-y-3"><p className="font-semibold">Sign in to see what your flows have done.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <>
      <section className="space-y-3"><h2 className="text-lg font-bold">Flow runs</h2>
        {runs === null && <p>Loading...</p>}
        {runs?.length === 0 && <p className="text-muted-foreground">Nothing has run yet.</p>}
        {runs?.map(r => <article key={r.message_id} className="rounded-lg border p-4 space-y-1"><p className="font-semibold">Outlook → Google Sheets · {LABEL[r.status] || r.status} · row {r.row_number}</p><p className="text-xs">{new Date(r.updated_at).toLocaleString()}</p>{r.error && <p role="alert" className="text-sm text-destructive">{r.error}</p>}</article>)}
      </section>
      <EmailVerification />
    </>}
  </div></div></main>;
}
