"use client";

import { useEffect, useState } from "react";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

type Item = { id: string; title: string };

export default function DemoLeoPage() {
  const { data: session, isPending } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedIn = !!session?.user && !session.user.isAnonymous;

  useEffect(() => {
    setItems([]);
    if (signedIn) {
      fetch("/api/demo-leo")
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => setError("No pudimos cargar la demo."));
    }
  }, [signedIn]);

  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/demo-leo", { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "No pudimos preparar la demo.");
        return;
      }
      setItems(d.items);
    } catch {
      setError("No pudimos preparar la demo. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <header className="space-y-2">
          <p className="font-medium text-sm">PREVIEW · Datos ficticios</p>
          <h1 className="font-semibold text-2xl">Tu demo de cinco casos</h1>
          <p className="text-muted-foreground text-sm">
            Stock, envíos, conciliación, avisos y soporte. Sin conexiones reales
            ni mensajes enviados. No es producción.
          </p>
        </header>
        {isPending && <p>Verificando sesión...</p>}
        {!(isPending || signedIn) && (
          <AuthDialog>
            <Button>Iniciar sesión</Button>
          </AuthDialog>
        )}
        {signedIn && (
          <>
            <p className="break-words text-sm">Sesión: {session.user.email}</p>
            {items.length === 0 && (
              <Button disabled={busy} onClick={prepare}>
                {busy
                  ? "Preparando..."
                  : "Preparar mis cinco ejemplos ficticios"}
              </Button>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => (
                <a
                  className="rounded-xl border p-4 font-medium hover:bg-muted"
                  href={`/frontend/${item.id}`}
                  key={item.id}
                >
                  {item.title}
                </a>
              ))}
            </div>
          </>
        )}
        {error && (
          <p className="text-sm" role="alert">
            {error}
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          Los botones Ejecutar recalculan sólo los ejemplos guardados en esta
          empresa de demo. No conectes proveedores ni agregues credenciales. Tu
          acceso habitual y sus conexiones no se modifican.
        </p>
      </div>
    </main>
  );
}
