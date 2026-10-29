"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
type Data = {
  organization: { id: string; name: string };
  items: { id: string; name: string; active: boolean }[];
  scopeNote: string;
};
export default function Company({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = use(params);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    fetch(
      "/api/org/workflows?organizationId=" + encodeURIComponent(organizationId),
    )
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw Error(j.error);
        if (active) setData(j);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);
  return (
    <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background">
      <AppHeader />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <Link className="underline" href="/">
            ← Empresas
          </Link>
          {error ? (
            <p role="alert">{error}</p>
          ) : !data ? (
            <p role="status">Cargando empresa…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Empresa</p>
                  <h1 className="break-words text-2xl font-bold">
                    {data.organization.name}
                  </h1>
                </div>
                <Button asChild>
                  <Link
                    href={
                      "/new-workflow?organizationId=" +
                      encodeURIComponent(organizationId)
                    }
                  >
                    Crear workflow
                  </Link>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{data.scopeNote}</p>
              <Link className="inline-block underline" href={'/companies/'+encodeURIComponent(organizationId)+'/variables'}>Definir variables de la empresa</Link><h2 className="text-xl font-semibold">Workflows</h2>
              {data.items.length ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.items.map((w) => (
                    <article className="rounded-xl border p-5" key={w.id}>
                      <h3 className="font-semibold">{w.name}</h3>
                      <p className="my-3 text-sm text-muted-foreground">
                        {w.active ? "Activo" : "Pausado"}
                      </p>
                      <Link
                        className="underline"
                        href={"/workflows/" + encodeURIComponent(w.id)}
                      >
                        Abrir workflow
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-6">
                  <h3 className="font-semibold">
                    No hay workflows asignados que puedas abrir
                  </h3>
                  <p className="mt-2">
                    Creá uno para esta empresa. Los anteriores no se movieron.
                  </p>
                </div>
              )}
              <Link className="inline-block underline" href="/workflows">
                Todos mis workflows existentes
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
