"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
// The fixed /mail-flow address now forwards to the flow's own ID page (keeps the Google return query).
export default function MailFlowRedirect() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      try {
        const d = await (await fetch("/api/flows", { cache: "no-store" })).json();
        const f = d.flows?.find((x: { kind: string }) => x.kind === "mail-sheets");
        router.replace(f ? `/flows/${f.id}${window.location.search}` : "/flows");
      } catch { router.replace("/flows"); }
    })();
  }, [router]);
  return <main className="p-6">Opening your flow...</main>;
}
