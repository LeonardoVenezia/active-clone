"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Catalog } from "./catalog";
import { useSession } from "@/lib/auth-client";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
export default function Connections() {
  const { data: session, isPending } = useSession();
  const [mlResult, setMlResult] = useState<string | null>(null);
  const signedIn = !!session?.user && !session.user.isAnonymous;
  useEffect(() => {
    document.title = "Connections | Active-clone";
    const params = new URLSearchParams(window.location.search);
    setMlResult(params.get("mercadolibre"));
    const toolkitId = params.get("returned");
    if (params.get("popup") !== "1" || !toolkitId || !/^[a-z0-9_]{1,60}$/.test(toolkitId)) return;
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "active-clone:connection-complete", toolkitId }, window.location.origin);
      window.close();
    }
  }, []);
  return <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background p-6"><div className="mx-auto max-w-3xl space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Connections</h1><div className="flex gap-4 text-sm"><Link className="underline" href="/workflows">Flows</Link><Link className="underline" href="/history">History</Link><Link className="underline" href="/">Editor</Link></div></div>
    {mlResult && <div className={"rounded-xl border p-4 text-sm " + (mlResult === "connected" || mlResult === "ok" ? "border-green-600" : "border-red-600")}>{mlResult === "connected" || mlResult === "ok" ? "Mercado Libre conectado. Ya podés elegir esa conexión en un paso del editor." : mlResult === "not-configured" ? "Mercado Libre todavía no está configurado en el servidor (faltan MERCADOLIBRE_APP_ID / MERCADOLIBRE_APP_SECRET)." : mlResult === "invalid-state" ? "No se pudo verificar el inicio de sesión de Mercado Libre. Probá de nuevo." : "No se pudo conectar Mercado Libre (" + mlResult + ")."}</div>}
    <p className="text-muted-foreground">Connect the apps your flows use. You always see what a connection allows before you approve it, and we verify what was really granted afterwards.</p>
    {isPending ? <p>Loading session...</p> : !signedIn ? <div className="rounded-xl border p-5 space-y-3"><p className="font-semibold">Sign in to connect apps.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <Catalog signedIn={signedIn} />}
  </div></main>;
}
