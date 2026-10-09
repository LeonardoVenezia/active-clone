"use client";

import Link from "next/link";
import { useState } from "react";
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (reset && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (reset) {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        if (!token || params.get("error")) {
          setError("This reset link is invalid or expired. Request a new one.");
          return;
        }
        const response = await authClient.resetPassword({
          newPassword: password,
          token,
        });
        if (response.error) {
          setError("This reset link is invalid or expired. Request a new one.");
          return;
        }
        setPassword("");
        setConfirmation("");
        setMessage("Password changed. Sign in with your new password.");
      } else {
        const response = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (response.error) {
          setError("Could not request a reset. Try again later.");
          return;
        }
        setMessage(
          "If an account exists for that address, you will receive a reset link.",
        );
      }
    } catch {
      setError("Could not complete the request. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pointer-events-auto relative z-20 mx-auto mt-20 w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
      <h1 className="text-2xl font-semibold">
        {reset ? "Choose a new password" : "Reset your password"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {reset
          ? "Use at least 8 characters."
          : "Enter your account email to request a reset link."}
      </p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {reset ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
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
              <Label htmlFor="confirm-password">Confirm password</Label>
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
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Working..." : reset ? "Change password" : "Send reset link"}
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
