"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AuthDialog } from "@/components/auth/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
type SeatUsage = {
  memberCap: number | null;
  memberCount: number;
  pendingCount: number;
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

function roleLabel(role?: string) {
  if (role === "owner") return "dueño";
  if (role === "admin") return "admin";
  return "worker";
}

export default function OrgPage() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user && !session.user.isAnonymous;
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [orgInvites, setOrgInvites] = useState<Invitation[]>([]);
  const [myInvites, setMyInvites] = useState<Invitation[]>([]);
  const [seatUsage, setSeatUsage] = useState<SeatUsage | null>(null);
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [capInput, setCapInput] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);
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
      setSeatUsage(null);
      return;
    }
    const [{ data }, usageRes] = await Promise.all([
      authClient.organization.getFullOrganization({
        query: { organizationId },
      }),
      fetch(`/api/org/member-cap?organizationId=${organizationId}`),
    ]);
    setMembers((data?.members as Member[]) || []);
    setOrgInvites(
      ((data?.invitations as Invitation[]) || []).filter(
        (i) => i.status === "pending"
      )
    );
    if (usageRes.ok) {
      const usage = (await usageRes.json()) as SeatUsage;
      setSeatUsage(usage);
      setCapInput(usage.memberCap != null ? String(usage.memberCap) : "");
    } else {
      setSeatUsage(null);
    }
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

  async function changeRole(member: Member, role: string) {
    if (!activeOrgId) return;
    setBusy(true);
    try {
      const { error } = await authClient.organization.updateMemberRole({
        memberId: member.id,
        role,
        organizationId: activeOrgId,
      });
      if (error) throw new Error(error.message || "No se pudo cambiar el rol.");
      toast.success(
        `${member.user?.email || "Miembro"} ahora es ${roleLabel(role)}.`
      );
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
      await loadOrgDetail(activeOrgId);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember() {
    const member = removeTarget;
    if (!member || !activeOrgId) return;
    setBusy(true);
    try {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId: activeOrgId,
      });
      if (error) throw new Error(error.message || "No se pudo quitar.");
      toast.success(`${member.user?.email || "Miembro"} ya no es parte de la empresa.`);
      setRemoveTarget(null);
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite() {
    const invite = cancelTarget;
    if (!invite || !activeOrgId) return;
    setBusy(true);
    try {
      const { error } = await authClient.organization.cancelInvitation({
        invitationId: invite.id,
      });
      if (error) throw new Error(error.message || "No se pudo cancelar.");
      toast.success(`Invitación a ${invite.email} cancelada.`);
      setCancelTarget(null);
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCap() {
    if (!activeOrgId) return;
    const raw = capInput.trim();
    const memberCap = raw === "" ? null : Number(raw);
    if (memberCap != null && (!Number.isInteger(memberCap) || memberCap < 1)) {
      toast.error("El límite tiene que ser un número entero mayor a 0.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/org/member-cap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: activeOrgId, memberCap }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");
      toast.success(
        memberCap != null
          ? `Límite de miembros: ${memberCap}.`
          : "La empresa ya no tiene límite de miembros."
      );
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  const activeOrg = orgs?.find((o) => o.id === activeOrgId) || null;
  const viewerRole =
    members.find((m) => m.userId === session?.user?.id)?.role || null;
  const canManage = viewerRole === "owner" || viewerRole === "admin";

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
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold">
                      Miembros de {activeOrg.name}
                    </h2>
                    {seatUsage && (
                      <p className="text-xs text-muted-foreground">
                        {seatUsage.memberCount}
                        {seatUsage.pendingCount > 0 &&
                          ` + ${seatUsage.pendingCount} invitado${seatUsage.pendingCount === 1 ? "" : "s"}`}
                        {seatUsage.memberCap != null &&
                          ` · límite ${seatUsage.memberCap}`}
                      </p>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {members.map((m) => {
                      const isSelf = m.userId === session?.user?.id;
                      const manageable =
                        canManage && !isSelf && m.role !== "owner";
                      return (
                        <li
                          className="flex flex-wrap items-center justify-between gap-2"
                          key={m.id}
                        >
                          <p className="text-sm">
                            {m.user?.name || m.user?.email || m.userId}
                            {isSelf && (
                              <span className="text-muted-foreground">
                                {" "}
                                (vos)
                              </span>
                            )}
                          </p>
                          {manageable ? (
                            <div className="flex items-center gap-2">
                              <select
                                className="h-8 rounded-md border bg-background px-2 text-sm"
                                disabled={busy}
                                onChange={(e) =>
                                  void changeRole(m, e.target.value)
                                }
                                value={m.role}
                              >
                                <option value="member">Worker</option>
                                <option value="admin">Admin</option>
                              </select>
                              <Button
                                disabled={busy}
                                onClick={() => setRemoveTarget(m)}
                                size="sm"
                                variant="outline"
                              >
                                Quitar
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {roleLabel(m.role)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                    {orgInvites.map((inv) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2"
                        key={inv.id}
                      >
                        <p className="text-sm text-muted-foreground">
                          {inv.email} · invitado (
                          {inv.role === "admin" ? "admin" : "worker"})
                        </p>
                        {canManage && (
                          <Button
                            disabled={busy}
                            onClick={() => setCancelTarget(inv)}
                            size="sm"
                            variant="outline"
                          >
                            Cancelar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>

                  {canManage && (
                    <div className="space-y-2 border-t pt-4">
                      <p className="text-sm font-medium">Límite de miembros</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="w-28"
                          inputMode="numeric"
                          min={1}
                          onChange={(e) => setCapInput(e.target.value)}
                          placeholder="Sin límite"
                          type="number"
                          value={capInput}
                        />
                        <Button
                          disabled={busy}
                          onClick={() => void saveCap()}
                          size="sm"
                          variant="outline"
                        >
                          Guardar
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Vacío = sin límite. Cuentan miembros e invitaciones
                          pendientes.
                        </p>
                      </div>
                    </div>
                  )}

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

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        open={!!removeTarget}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Quitar a {removeTarget?.user?.email || "este miembro"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Va a perder acceso a los flows y plantillas de la empresa. Podés
              volver a invitarlo después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void removeMember()}
            >
              Quitar de la empresa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        open={!!cancelTarget}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar invitación</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.email} ya no va a poder unirse con esta
              invitación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void cancelInvite()}
            >
              Cancelar invitación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
