"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invalidLink, setInvalidLink] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!reset) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("token") || params.get("error")) {
      setInvalidLink(true);
      setError("Este enlace es inválido o ya venció. Pedí uno nuevo.");
    }
  }, [reset]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalidLink || completed) return;
    setError("");
    setMessage("");
    if (reset && password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      if (reset) {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        if (!token || params.get("error")) {
          setError("Este enlace es inválido o ya venció. Pedí uno nuevo.");
          return;
        }
        const response = await authClient.resetPassword({
          newPassword: password,
          token,
        });
        if (response.error) {
          setError("Este enlace es inválido o ya venció. Pedí uno nuevo.");
          return;
        }
        setCompleted(true);
        setPassword("");
        setConfirmation("");
        setMessage("Contraseña cambiada. Iniciá sesión con la nueva.");
      } else {
        const response = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (response.error) {
          setError("No se pudo pedir el enlace. Probá de nuevo en un rato.");
          return;
        }
        setMessage(
          "Si hay una cuenta con ese email, te llega un enlace para recuperarla.",
        );
      }
    } catch {
      setError("No se pudo completar. Probá de nuevo en un rato.");
    } finally {
      setBusy(false);
    }
  }

  const done = completed || (!reset && !!message);
  if (done) {
    return (
      <main className="pointer-events-auto relative z-20 mx-auto mt-20 w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
        <h1 className="text-2xl font-semibold">
          {reset ? "Contraseña actualizada" : "Revisá tu email"}
        </h1>
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {reset
            ? "Tu contraseña ya fue cambiada. Iniciá sesión con la nueva."
            : `If an account exists for ${email}, we sent a link to reset your password. It may take a minute to arrive.`}
        </p>
        <div className="mt-6">
          <Link href="/" className="underline underline-offset-4">
            {reset ? "Go to Active-clone and sign in" : "Back to Active-clone"}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="pointer-events-auto relative z-20 mx-auto mt-20 w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
      <h1 className="text-2xl font-semibold">
        {reset ? "Elegí una contraseña nueva" : "Recuperá tu contraseña"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {reset
          ? "Use at least 8 characters."
          : "Ingresá el email de tu cuenta y te mandamos un enlace."}
      </p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {reset ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nueva contraseña</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmá la contraseña</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="recovery-email">Email</Label>
            <Input
              id="recovery-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={busy || invalidLink || completed}
        >
          {busy ? "Procesando..." : reset ? "Cambiar contraseña" : "Enviar enlace"}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/" className="underline underline-offset-4">
          Back to Active-clone
        </Link>
        {reset && (
          <Link
            href="/forgot-password"
            className="underline underline-offset-4"
          >
            Request a new link
          </Link>
        )}
      </div>
    </main>
  );
}
