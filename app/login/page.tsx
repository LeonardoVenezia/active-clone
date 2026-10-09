"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
function Login() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const safeNext = next.startsWith("/workflows/") && !next.includes("\\") ? next : "/";
  useEffect(() => {
    document.title = "Sign in | Active-clone";
    if (session?.user && !session.user.isAnonymous) router.replace(safeNext);
  }, [session, router, safeNext]);
  return <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background">
    <h1 className="text-2xl font-bold">Active-clone</h1>
    <p className="text-muted-foreground">Sign in to open your private workflow.</p>
    <AuthDialog defaultOpen><Button>Sign In</Button></AuthDialog>
  </main>;
}
export default function LoginPage() { return <Suspense><Login /></Suspense>; }
