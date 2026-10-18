"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AuthDialog } from "@/components/auth/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient, useSession } from "@/lib/auth-client";

type Org = { id: string; name: string; slug: string };
type Member = {
  id: string;
  userId: string;
  role: string;
  user?: { email?: string; name?: string };
};
type Invitation = {
  id: string;
  email: string;
  role?: string;
  status: string;
  organizationId?: string;
  organizationName?: string;
};

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "empresa"}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function OrgPage() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [orgInvites, setOrgInvites] = useState<Invitation[]>([]);
  const [myInvites, setMyInvites] = useState<Invitation[]>([]);
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: orgList }, { data: sessionData }, { data: invs }] =
      await Promise.all([
        authClient.organization.list(),
        authClient.getSession(),
        authClient.organization.listUserInvitations(),
      ]);
    setOrgs((orgList as Org[]) || []);
    setActiveOrgId(
      (sessionData?.session?.activeOrganizationId as string | null) || null
    );
    setMyInvites(
      ((invs as Invitation[]) || []).filter((i) => i.status === "pending")
    );
  }, []);

  const loadOrgDetail = useCallback(async (organizationId: string | null) => {
    if (!organizationId) {
      setMembers([]);
      setOrgInvites([]);
      return;
    }
    const { data } = await authClient.organization.getFullOrganization({
      query: { organizationId },
    });
    setMembers((data?.members as Member[]) || []);
    setOrgInvites(
      ((data?.invitations as Invitation[]) || []).filter(
        (i) => i.status === "pending"
      )
    );
  }, []);

  useEffect(() => {
    document.title = "Empresa | Active-clone";
    if (!signedIn) {
      setOrgs([]);
      return;
    }
    void load();
  }, [signedIn, load]);

  useEffect(() => {
    void loadOrgDetail(activeOrgId);
  }, [activeOrgId, loadOrgDetail]);

  async function createOrg() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { error } = await authClient.organization.create({
        name,
        slug: slugify(name),
      });
      if (error) throw new Error(error.message || "No se pudo crear.");
      toast.success(`Empresa "${name}" creada. Ya quedó activa.`);
      setNewName("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string | null) {
    setBusy(true);
    try {
      const { error } = await authClient.organization.setActive({
        organizationId: id,
      });
      if (error) throw new Error(error.message || "No se pudo activar.");
      setActiveOrgId(id);
      toast.success(id ? "Empresa activada." : "Volviste a tu espacio personal.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const email = inviteEmail.trim();
    if (!email || !activeOrgId) return;
    setBusy(true);
    try {
      const { error } = await authClient.organization.inviteMember({
        email,
        role: inviteRole,
        organizationId: activeOrgId,
      });
      if (error) throw new Error(error.message || "No se pudo invitar.");
      toast.success(`Invitación enviada a ${email}.`);
      setInviteEmail("");
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  async function answer(invite: Invitation, accept: boolean) {
    setBusy(true);
    try {
      const fn = accept
        ? authClient.organization.acceptInvitation
        : authClient.organization.rejectInvitation;
      const { error } = await fn({ invitationId: invite.id });
      if (error) throw new Error(error.message || "No se pudo responder.");
      toast.success(accept ? "Te uniste a la empresa." : "Invitación rechazada.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  const activeOrg = orgs?.find((o) => o.id === activeOrgId) || null;

  return (
    <main className="pointer-events-auto fixed inset-0 z-20 flex flex-col bg-background">
      <AppHeader />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="text-2xl font-bold">Empresa</h1>
          {isPending ? (
            <p>Cargando...</p>
          ) : !signedIn ? (
            <div className="space-y-3 rounded-xl border p-5">
              <p className="font-semibold">
                Iniciá sesión para crear o administrar tu empresa.
              </p>
              <AuthDialog>
                <Button>Sign In</Button>
              </AuthDialog>
            </div>
          ) : (
            <>
              {myInvites.length > 0 && (
                <div className="space-y-3 rounded-xl border p-5">
                  <h2 className="text-lg font-semibold">
                    Invitaciones para vos
                  </h2>
                  <ul className="space-y-2">
                    {myInvites.map((inv) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2"
                        key={inv.id}
                      >
                        <p className="text-sm">
                          Te invitaron a una empresa como{" "}
                          {inv.role === "admin" ? "admin" : "worker"}.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            disabled={busy}
                            onClick={() => void answer(inv, true)}
                            size="sm"
                          >
                            Aceptar
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() => void answer(inv, false)}
                            size="sm"
                            variant="outline"
                          >
                            Rechazar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-3 rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Crear empresa</h2>
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="min-w-0 flex-1"
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nombre de la empresa"
                    value={newName}
                  />
                  <Button
                    disabled={busy || !newName.trim()}
                    onClick={() => void createOrg()}
                  >
                    Crear
                  </Button>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Tus empresas</h2>
                {orgs === null ? (
                  <p>Cargando...</p>
                ) : orgs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Todavía no pertenecés a ninguna empresa.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {orgs.map((o) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2"
                        key={o.id}
                      >
                        <p className="font-medium">
                          {o.name}{" "}
                          {o.id === activeOrgId && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                              Activa
                            </span>
                          )}
                        </p>
                        {o.id !== activeOrgId && (
                          <Button
                            disabled={busy}
                            onClick={() => void setActive(o.id)}
                            size="sm"
                            variant="outline"
                          >
                            Activar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {activeOrgId && (
                  <Button
                    disabled={busy}
                    onClick={() => void setActive(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Volver a mi espacio personal
                  </Button>
                )}
              </div>

              {activeOrg && (
                <div className="space-y-4 rounded-xl border p-5">
                  <h2 className="text-lg font-semibold">
                    Miembros de {activeOrg.name}
                  </h2>
                  <ul className="space-y-1">
                    {members.map((m) => (
                      <li className="text-sm" key={m.id}>
                        {m.user?.name || m.user?.email || m.userId} ·{" "}
                        <span className="text-muted-foreground">
                          {m.role === "member" ? "worker" : m.role}
                        </span>
                      </li>
                    ))}
                    {orgInvites.map((inv) => (
                      <li
                        className="text-sm text-muted-foreground"
                        key={inv.id}
                      >
                        {inv.email} · invitado (
                        {inv.role === "admin" ? "admin" : "worker"})
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Invitar por email</p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="min-w-0 flex-1"
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="email@empresa.com"
                        type="email"
                        value={inviteEmail}
                      />
                      <select
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        onChange={(e) =>
                          setInviteRole(e.target.value as "member" | "admin")
                        }
                        value={inviteRole}
                      >
                        <option value="member">Worker</option>
                        <option value="admin">Admin</option>
                      </select>
                      <Button
                        disabled={busy || !inviteEmail.trim()}
                        onClick={() => void invite()}
                      >
                        Invitar
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
