"use client";
import { useEffect } from "react";
import Link from "next/link";
import { EmailVerification } from "./email-verification";
import { Catalog } from "./catalog";
import { useSession } from "@/lib/auth-client";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
export default function Connections() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  useEffect(() => { document.title = "Connections | Active-clone"; }, []);
  return <main className="pointer-events-auto fixed inset-0 z-20 overflow-auto bg-background p-6"><div className="mx-auto max-w-3xl space-y-6">
    <Link className="text-sm underline" href="/">Back to Active-clone</Link>
    <h1 className="text-2xl font-bold">Connections</h1>
    <p className="text-muted-foreground">Connect the apps your flows use. You always see what a connection allows before you approve it, and we verify what was really granted afterwards.</p>
    <Link className="block rounded-lg border p-4 underline" href="/mail-flow">Outlook → Google Sheets flow</Link>
    <EmailVerification />
    {isPending ? <p>Loading session...</p> : !signedIn ? <AuthDialog><Button>Sign In</Button></AuthDialog> : <Catalog signedIn={signedIn} />}
  </div></main>;
}
