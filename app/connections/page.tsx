"use client";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { Catalog } from "./catalog";
import { useSession } from "@/lib/auth-client";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
export default function Connections() {
  const { data: session, isPending } = useSession();
  const [mlResult, setMlResult] = useState<string | null>(null);
  const [mpResult, setMpResult] = useState<string | null>(null);
  const signedIn = !!session?.user && !session.user.isAnonymous;
  useEffect(() => {
    document.title = "Connections | Active-clone";
    const params = new URLSearchParams(window.location.search);
    setMlResult(params.get("mercadolibre"));
    setMpResult(params.get("mercadopago"));
    const toolkitId = params.get("returned");
    if (params.get("popup") !== "1" || !toolkitId || !/^[a-z0-9_]{1,60}$/.test(toolkitId)) return;
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "active-clone:connection-complete", toolkitId }, window.location.origin);
      window.close();
    }
  }, []);
  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background"><AppHeader /><div className="flex-1 overflow-auto p-6"><div className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold">Connections</h1>
    {mlResult && <div className={"rounded-xl border p-4 text-sm " + (mlResult === "connected" || mlResult === "ok" ? "border-green-600" : "border-red-600")}>{mlResult === "connected" || mlResult === "ok" ? "Mercado Libre conectado. Ya podés elegir esa conexión en un paso del editor." : mlResult === "not-configured" ? "Mercado Libre todavía no está configurado en el servidor (faltan MERCADOLIBRE_APP_ID / MERCADOLIBRE_APP_SECRET)." : mlResult === "invalid-state" ? "No se pudo verificar el inicio de sesión de Mercado Libre. Probá de nuevo." : "No se pudo conectar Mercado Libre (" + mlResult + ")."}</div>}
    {mpResult && <div className={"rounded-xl border p-4 text-sm " + (mpResult === "connected" ? "border-green-600" : "border-red-600")}>{mpResult === "connected" ? "Mercado Pago conectado. Ya podés elegir esa conexión en un paso del editor." : mpResult === "not-configured" ? "Mercado Pago todavía no está configurado en el servidor (faltan MERCADOPAGO_CLIENT_ID / MERCADOPAGO_CLIENT_SECRET)." : mpResult === "invalid-state" ? "No se pudo verificar el inicio de sesión de Mercado Pago. Probá de nuevo." : mpResult === "access_denied" ? "No autorizaste la aplicación en Mercado Pago. Probá de nuevo." : "No se pudo conectar Mercado Pago (" + mpResult + ")."}</div>}
    <p className="text-muted-foreground">Connect the apps your flows use. You always see what a connection allows before you approve it, and we verify what was really granted afterwards.</p>
    {isPending ? <p>Loading session...</p> : !signedIn ? <div className="rounded-xl border p-5 space-y-3"><p className="font-semibold">Sign in to connect apps.</p><AuthDialog><Button>Sign In</Button></AuthDialog></div> : <Catalog signedIn={signedIn} />}
  </div></div></main>;
}
