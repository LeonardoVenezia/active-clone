"use client";

import { useState } from "react";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import type { PanelAccessState } from "@/lib/datos/panel-access";

export function PanelAccessRecovery({
  state,
  email,
  onRetry,
}: {
  state: Exclude<PanelAccessState, null>;
  email?: string;
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changeAccount() {
    setBusy(true);
    setError("");
    try {
      const result = await signOut();
      if (result.error) {
        setError("No pudimos cerrar la sesión. Probá de nuevo.");
      }
    } catch {
      setError("No pudimos cerrar la sesión. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const headings = {
    checking: "Verificando tu sesión...",
    signin: "Iniciá sesión para abrir este panel",
    forbidden: "Esta cuenta no tiene acceso a este panel",
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <h1 className="font-semibold text-2xl tracking-tight">Panel</h1>
      <div className="space-y-3 rounded-xl border border-warning bg-warning-subtle p-5 text-warning-foreground">
        <h2 className="font-medium">{headings[state]}</h2>
        {state === "signin" && (
          <p className="text-sm">
            Usá la cuenta a la que se le dio acceso. Abrir el enlace no da
            permisos sobre el workflow ni sobre su empresa.
          </p>
        )}
        {state === "forbidden" && (
          <>
            <p className="break-words text-sm">Sesión actual: {email}</p>
            <p className="text-sm">
              Si es otra cuenta, cerrá esta sesión e ingresá con la correcta. Si
              es tu cuenta, pedile al responsable que revise el acceso al
              workflow y a su empresa. No hace falta publicar en producción.
            </p>
          </>
        )}
      </div>
      {state !== "checking" && (
        <div className="flex flex-wrap gap-3">
          {state === "signin" ? (
            <AuthDialog>
              <Button>Iniciar sesión</Button>
            </AuthDialog>
          ) : (
            <Button disabled={busy} onClick={changeAccount}>
              {busy
                ? "Cerrando sesión..."
                : "Cerrar sesión para cambiar de cuenta"}
            </Button>
          )}
          <Button onClick={onRetry} variant="outline">
            Reintentar acceso
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm" role="alert">
          {error}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        No se muestran datos ni se ejecuta el workflow sin los permisos
        necesarios.
      </p>
    </section>
  );
}
