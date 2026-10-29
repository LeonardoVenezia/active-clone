"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";
type Company = { id: string; name: string; slug: string };
export default function Companies() {
  const { data: session, isPending } = useSession();
  const [items, setItems] = useState<Company[] | null>(null),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const signedIn = !!session?.user && !session.user.isAnonymous;
  async function load() {
    setError("");
    const result = await authClient.organization.list();
    if (result.error) {
      setError(result.error.message || "No pudimos cargar tus empresas.");
      return;
    }
    setItems((result.data || []) as Company[]);
  }
  useEffect(() => {
    document.title = "Empresas | Active-clone";
    if (signedIn)
      load().catch(() => setError("No pudimos cargar tus empresas."));
    else setItems([]);
  }, [signedIn]);
  return (
    <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background">
      <AppHeader />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Tus empresas</h1>
            <p className="mt-2 text-muted-foreground">
              Elegí una empresa para trabajar en sus workflows.
            </p>
          </div>
          {isPending ? (
            <p role="status">Cargando sesión…</p>
          ) : !signedIn ? (
            <div className="rounded-xl border p-6">
              <p className="mb-4">Ingresá para ver y crear empresas.</p>
              <AuthDialog>
                <Button>Iniciar sesión</Button>
              </AuthDialog>
            </div>
          ) : (
            <>
              <form
                className="flex flex-wrap items-end gap-3 rounded-xl border p-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const result = await authClient.organization.create({
                      name: name.trim(),
                      slug: "empresa-" + crypto.randomUUID(),
                    });
                    if (result.error) throw Error(result.error.message);
                    setName("");
                    await load();
                  } catch (e) {
                    setError(
                      (e as Error).message || "No pudimos crear la empresa.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-2">
                  Nombre de la nueva empresa
                  <input
                    className="rounded-md border bg-background p-2"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <Button disabled={busy || !name.trim()}>Crear empresa</Button>
              </form>
              {error && <p role="alert">{error}</p>}
              {items === null ? (
                <p role="status">Cargando empresas…</p>
              ) : items.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((o) => (
                    <article className="rounded-xl border p-5" key={o.id}>
                      <h2 className="break-words text-lg font-semibold">
                        {o.name}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Workflows de esta empresa, dentro de tu acceso.
                      </p>
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <Button asChild>
                          <Link href={"/companies/" + encodeURIComponent(o.id)}>
                            Ver workflows
                          </Link>
                        </Button>
                        <details className="relative">
                          <summary
                            className="cursor-pointer rounded border px-3 py-2"
                            aria-label={"Opciones de " + o.name}
                          >
                            Opciones
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 w-44 rounded border bg-background p-3 shadow">
                            <Link
                              className="underline"
                              href={"/companies/" + encodeURIComponent(o.id)}
                            >
                              Abrir empresa
                            </Link>
                          </div>
                        </details>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Todavía no tenés empresas. Creá la primera para empezar.</p>
              )}
              <section className="rounded-xl border p-5">
                <h2 className="font-semibold">Workflows existentes</h2>
                <p className="my-2 text-sm text-muted-foreground">
                  Los workflows personales o compartidos siguen accesibles. No
                  se asignan automáticamente a una empresa.
                </p>
                <Link className="underline" href="/workflows">
                  Todos mis workflows
                </Link>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
