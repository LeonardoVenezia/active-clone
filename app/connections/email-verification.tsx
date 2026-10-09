"use client";
import { useState } from "react";
import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
export function EmailVerification() {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!session?.user || session.user.isAnonymous) return null;
  async function resend() {
    if (!session?.user) return;
    setBusy(true); setMessage("");
    try {
      const result = await authClient.sendVerificationEmail({ email: session.user.email, callbackURL: `${window.location.origin}/connections` });
      setMessage(result.error ? result.error.message || "Could not send verification email." : "Verification email requested. Check your inbox and spam folder.");
    } catch { setMessage("Could not send verification email."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border p-4">
    <h2 className="font-semibold">Account email</h2>
    <p className="break-all text-sm">{session.user.email}</p>
    <p className="text-sm">{session.user.emailVerified ? "Email confirmed" : "Email not confirmed"}. Confirmation is recorded but does not restrict app access.</p>
    {!session.user.emailVerified && <Button variant="outline" disabled={busy} onClick={() => void resend()}>{busy ? "Sending..." : "Resend confirmation email"}</Button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
