"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import MailFlowView from "@/components/mail-flow-view";
export default function FlowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<"loading" | "mail" | "signin" | "error">("loading");
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/flows", { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (!d.signedIn) return setState("signin");
        if (d.flows.some((f: { id: string; kind: string }) => f.id === id && f.kind === "mail-sheets")) return setState("mail");
        router.replace(`/workflows/${id}`); // canvas workflows keep their own editor route
      } catch { setState("error"); }
    })();
  }, [id, router]);
  if (state === "mail") return <MailFlowView />;
  return <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background p-6"><div className="mx-auto max-w-3xl space-y-4"><Link href="/flows" className="underline text-sm">Back to flows</Link>
    {state === "loading" && <p>Loading flow...</p>}
    {state === "signin" && <p>Sign in to open this flow. <Link href="/flows" className="underline">Go to flows</Link></p>}
    {state === "error" && <p role="alert" className="text-destructive">Could not load this flow. Refresh to try again.</p>}
  </div></main>;
}
