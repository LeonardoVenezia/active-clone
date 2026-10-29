import { fixtureRateLimit } from "@/lib/console/rate-limit-test";
import {
  processDryRunOutbox,
  quarantineStaleDryRuns,
  reconcileDryRun,
} from "@/lib/console/outbox-test";
import {
  registerInvitedFixture,
  verifyFixtureEmail,
  queueDryRunNotice,
} from "@/lib/console/onboarding";
import {
  prepareReconnect,
  finishReconnect,
  completeProviderCallback,
} from "@/lib/console/reconnect";
import { integrations } from "@/lib/db/schema";
import {
  POST as inviteAction,
  GET as invitationList,
} from "@/app/api/console/v1/invitations/route";
import { GET as auditLog } from "@/app/api/console/v1/audit/route";
import {
  consoleAudit,
  consoleSetups,
  consoleAssignments,
} from "@/lib/console/schema";
import {
  GET as loadWorkflowSettings,
  POST as saveWorkflowSettings,
} from "@/app/api/console/v1/workflow-settings/route";
import {
  GET as listChanges,
  POST as submitChange,
} from "@/app/api/console/v1/change-requests/route";
import { POST as saveTeam } from "@/app/api/console/v1/team/route";
import {
  GET as getNotices,
  POST as saveNotices,
} from "@/app/api/console/v1/notifications/route";
// Isolated local PostgreSQL fixture only. Never run against a non-loopback database.
import { POST as executeRoute } from "@/app/api/console/v1/workflows/[workflowId]/execute/route";
import { reserveAndLaunch } from "@/lib/console/execution";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  organizations,
  members,
  workflows,
  workflowExecutions,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { consoleContext } from "@/lib/console/context";
import { effectiveGrant } from "@/lib/console/grants";
import {
  assignments,
  runtimeAssignments,
  visibleWorkflows,
} from "@/lib/console/data";
import { GET as bootstrap } from "@/app/api/console/v1/bootstrap/route";
import { GET as history } from "@/app/api/console/v1/history/route";
import { GET as team } from "@/app/api/console/v1/team/route";
import {
  GET as listOrgs,
  POST as selectOrg,
} from "@/app/api/console/v1/organizations/route";
import { eq } from "drizzle-orm";
import { sessions } from "@/lib/db/schema";
async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
  const now = new Date();
  const password = randomBytes(24).toString("hex");
  const hash = await hashPassword(password);
  for (const i of ["one", "two"]) {
    await db.insert(users).values({
      id: "u-" + i,
      name: i,
      email: i + "@fixture.local",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(accounts).values({
      id: "a-" + i,
      userId: "u-" + i,
      accountId: "u-" + i,
      providerId: "credential",
      password: hash,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(organizations).values({
      id: i,
      name: "Fixture " + i,
      slug: "fixture-" + i,
      createdAt: now,
    });
    await db.insert(members).values({
      id: "m-" + i,
      userId: "u-" + i,
      organizationId: i,
      role: "owner",
      createdAt: now,
    });
    await db.insert(workflows).values({
      id: "w-" + i,
      name: "Flow " + i,
      userId: "u-" + i,
      nodes: [],
      edges: [],
      active: false,
    });
    await db.insert(workflowExecutions).values({
      id: "r-" + i,
      workflowId: "w-" + i,
      userId: "u-" + i,
      status: "success",
      startedAt: now,
    });
  }
  await db.insert(workflows).values({
    id: "w-wrong-owner",
    name: "Not for org two",
    userId: "u-one",
    nodes: [],
    edges: [],
    active: false,
  });
  process.env.CONSOLE_ACCESS_CONFIG = JSON.stringify({
    organizations: {
      one: {
        users: {
          "u-one": {
            role: "admin",
            teamIds: [],
            workflowIds: [],
            canRun: false,
          },
        },
      },
      two: {
        users: {
          "u-two": {
            role: "operator",
            teamIds: [],
            workflowIds: ["w-two", "w-wrong-owner"],
            canRun: false,
          },
        },
      },
    },
    assignments: [
      { organizationId: "one", workflowId: "w-one", teamId: null },
      { organizationId: "two", workflowId: "w-two", teamId: null },
      { organizationId: "two", workflowId: "w-wrong-owner", teamId: null },
    ],
  });
  await db.insert(users).values({
    id: "team-target",
    name: "Team target",
    email: "target@fixture.local",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(members).values({
    id: "team-target-member",
    organizationId: "one",
    userId: "team-target",
    role: "member",
    createdAt: now,
  });
  const baseConfig = JSON.parse(process.env.CONSOLE_ACCESS_CONFIG!);
  baseConfig.assignments.find((x: any) => x.workflowId === "w-one").teamId =
    "sales";
  baseConfig.organizations.one.users["u-one"].teamIds = ["sales"];
  baseConfig.organizations.one.users["team-target"] = {
    role: "operator",
    teamIds: ["sales"],
    workflowIds: ["w-one"],
    canRun: false,
  };
  process.env.CONSOLE_ACCESS_CONFIG = JSON.stringify(baseConfig);
  const results = [];
  for (const i of ["one", "two"]) {
    const result = await auth.api.signInEmail({
      body: { email: i + "@fixture.local", password },
      asResponse: true,
      headers: new Headers({ origin: "http://localhost:4301" }),
    });
    assert.equal(result.status, 200, await result.clone().text());
    const cookie = result.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    assert(cookie.includes("better-auth.session_token"));
    const data = await result.json();
    const h = {
      cookie,
      origin: "http://localhost:4301",
      "Content-Type": "application/json",
    };
    const list = await (
      await listOrgs(new Request("http://localhost:4300", { headers: h }))
    ).json();
    assert.deepEqual(
      list.items.map((x: any) => x.id),
      [i],
    );
    const denied = await selectOrg(
      new Request("http://localhost:4300", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ organizationId: i === "one" ? "two" : "one" }),
      }),
    );
    assert.equal(denied.status, 403);
    const selected = await selectOrg(
      new Request("http://localhost:4300", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ organizationId: i }),
      }),
    );
    assert.equal(selected.status, 200);
    const request = new Request(
      "http://localhost:4300/api/console/v1/bootstrap",
      { headers: { cookie } },
    );
    const ctx = await consoleContext(request);
    assert.equal(ctx?.grant.organizationId, i);
    const response = await bootstrap(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.workflows.map((w: any) => w.id),
      ["w-" + i],
    );
    assert(!JSON.stringify(body).includes('"nodes"'));
    assert.equal(body.workflows[0].canRun, false);
    const runs = await (await history(request)).json();
    assert.equal(runs.items.length, 1);
    assert.equal(runs.items[0].workflowId, "w-" + i);
    const teamData = await (await team(request)).json();
    assert.deepEqual(
      teamData.items.map((u: any) => u.id).sort(),
      i === "one" ? ["team-target", "u-one"] : ["u-two"],
    );
    const forbiddenOrigin = await executeRoute(
      new Request("http://localhost:4300", {
        method: "POST",
        headers: { cookie, origin: "https://not-the-console.invalid" },
        body: "{}",
      }),
      { params: Promise.resolve({ workflowId: "w-" + i }) },
    );
    assert.equal(forbiddenOrigin.status, 403);
    const wrongFlow = await executeRoute(
      new Request("http://localhost:4300", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:4301" },
        body: "{}",
      }),
      {
        params: Promise.resolve({
          workflowId: i === "one" ? "w-two" : "w-one",
        }),
      },
    );
    assert.equal(wrongFlow.status, 403);
    process.env.CONSOLE_STORAGE_ENABLED = "true";
    await db
      .insert(consoleAudit)
      .values({
        id: "audit-" + i,
        organizationId: i,
        actorId: "u-" + i,
        subjectId: "w-" + i,
        action: "notification.settings.updated",
      });
    const auditItems = (await (await auditLog(request)).json()).items;
    assert.ok(auditItems.some((x: any) => x.id === "audit-" + i));
    assert.ok(
      auditItems.every(
        (x: any) => x.id !== "audit-" + (i === "one" ? "two" : "one"),
      ),
    );
    const prefRequest = () =>
      new Request("http://localhost:4300", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:4301" },
        body: JSON.stringify({ showFailures: false }),
      });
    assert.equal((await saveNotices(prefRequest())).status, 200);
    assert.equal(
      (await (await getNotices(request)).json()).showFailures,
      false,
    );
    const deniedEdit = await saveTeam(
      new Request("http://localhost:4300", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:4301" },
        body: JSON.stringify({
          userId: i === "one" ? "u-two" : "u-one",
          role: "admin",
          enabled: true,
          canRun: true,
          teamIds: [],
          workflowIds: [],
        }),
      }),
    );
    assert.equal(deniedEdit.status, 403);
    const settingsBody = {
      workflowId: "w-" + i,
      notifyFailure: false,
      notifyConnection: true,
      notifyApproval: true,
    };
    const post = (body: any) =>
      new Request("http://localhost:4300", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:4301" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await saveWorkflowSettings(post(settingsBody))).status,
      i === "one" ? 200 : 403,
    );
    assert.equal(
      (
        await saveWorkflowSettings(
          post({
            ...settingsBody,
            workflowId: i === "one" ? "w-two" : "w-one",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await submitChange(
          post({ workflowId: "w-" + i, description: "Fixture change request" }),
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await submitChange(
          post({
            workflowId: i === "one" ? "w-two" : "w-one",
            description: "Fixture change request",
          }),
        )
      ).status,
      403,
    );
    const changeList = await (await listChanges(request)).json();
    assert.equal(changeList.items.length, 1);
    assert.equal(changeList.items[0].workflowId, "w-" + i);
    const settingsRead = await (await loadWorkflowSettings(request)).json();
    assert.deepEqual(
      settingsRead.items.map((x: any) => x.id),
      ["w-" + i],
    );
    if (i === "one") {
      const edit = (
        role: string,
        teamIds: string[],
        workflowIds: string[],
        enabled = true,
      ) =>
        saveTeam(
          new Request("http://localhost:4300", {
            method: "POST",
            headers: { cookie, origin: "http://localhost:4301" },
            body: JSON.stringify({
              userId: "team-target",
              role,
              teamIds,
              workflowIds,
              canRun: false,
              enabled,
            }),
          }),
        );
      assert.equal((await edit("manager", ["sales"], ["w-one"])).status, 200);
      assert.equal((await edit("admin", ["sales"], [])).status, 403);
      assert.equal((await edit("operator", ["sales"], ["w-two"])).status, 403);
      assert.equal((await edit("operator", ["sales"], ["w-one"])).status, 200);
      const managerConfig = JSON.parse(process.env.CONSOLE_ACCESS_CONFIG!);
      managerConfig.organizations.one.users["u-one"].role = "manager";
      process.env.CONSOLE_ACCESS_CONFIG = JSON.stringify(managerConfig);
      assert.equal((await edit("operator", ["sales"], ["w-one"])).status, 200);
      assert.equal(
        (await edit("operator", ["finance"], ["w-one"])).status,
        403,
      );
      assert.equal((await edit("manager", ["sales"], ["w-one"])).status, 403);
      const managedList = await (await team(request)).json();
      assert.deepEqual(managedList.teams, ["sales"]);
      assert.deepEqual(
        managedList.workflows.map((w: any) => w.id),
        ["w-one"],
      );
      assert.equal(
        managedList.items.find((u: any) => u.id === "team-target").editable,
        true,
      );
      assert.equal(
        (await edit("operator", ["sales"], ["w-one"], false)).status,
        200,
      );
      const { effectiveGrant } = await import("@/lib/console/grants");
      assert.equal(await effectiveGrant("team-target", "one"), null);
      const keptMembership = await db
        .select()
        .from(members)
        .where(eq(members.userId, "team-target"));
      assert.equal(keptMembership.length, 1);
      assert.equal((await edit("operator", ["sales"], ["w-one"])).status, 200);
      process.env.CONSOLE_ACCESS_CONFIG = JSON.stringify(baseConfig);
    }
    if (i === "one") {
      process.env.CONSOLE_RECONNECT_ENABLED = "true";
      process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
      await db
        .insert(integrations)
        .values({
          id: "fixture-connection",
          userId: "u-one",
          name: "Fixture only",
          type: "openai" as any,
          config: "unused-fixture",
        });
      await db
        .update(workflows)
        .set({
          nodes: [
            {
              id: "fixture-node",
              data: { config: { integrationId: "fixture-connection" } },
            },
          ],
        })
        .where(eq(workflows.id, "w-one"));
      const ticket = await prepareReconnect(request, "fixture-connection");
      await assert.rejects(() =>
        finishReconnect(request, ticket.id, {
          providerType: "wrong",
          config: { token: "fictitious" },
        }),
      );
      const done = await finishReconnect(request, ticket.id, {
        providerType: "openai",
        config: { token: "fictitious-not-real" },
      });
      assert.equal(done.integrationId, "fixture-connection");
      await assert.rejects(() =>
        finishReconnect(request, ticket.id, {
          providerType: "openai",
          config: { token: "fictitious" },
        }),
      );
      const stored = (
        await db
          .select()
          .from(integrations)
          .where(eq(integrations.id, "fixture-connection"))
      )[0];
      assert.equal(stored.userId, "u-one");
      assert.equal(stored.name, "Fixture only");
      assert.ok(
        typeof stored.config === "string" &&
          !stored.config.includes("fictitious"),
      );
      let exchanges = 0;
      const fakeAdapter = {
        type: "openai",
        exchange: async (code: string) => {
          exchanges++;
          if (code !== "fictitious-code") throw Error("Invalid fixture code");
          return {
            config: { token: "fictitious-provider-token" },
            verified: true,
          };
        },
      };
      const callbackTicket = await prepareReconnect(
        request,
        "fixture-connection",
      );
      delete process.env.CONSOLE_RECONNECT_ENABLED;
      await assert.rejects(() =>
        completeProviderCallback(
          request,
          {
            ticketId: callbackTicket.id,
            state: callbackTicket.id,
            code: "fictitious-code",
          },
          fakeAdapter,
        ),
      );
      assert.equal(exchanges, 0);
      process.env.CONSOLE_RECONNECT_ENABLED = "true";
      await assert.rejects(() =>
        completeProviderCallback(
          request,
          {
            ticketId: callbackTicket.id,
            state: "wrong-state",
            code: "fictitious-code",
          },
          fakeAdapter,
        ),
      );
      assert.equal(exchanges, 0);
      await assert.rejects(() =>
        completeProviderCallback(
          request,
          {
            ticketId: callbackTicket.id,
            state: callbackTicket.id,
            code: "invalid",
          },
          fakeAdapter,
        ),
      );
      await assert.rejects(() =>
        completeProviderCallback(
          request,
          {
            ticketId: callbackTicket.id,
            state: callbackTicket.id,
            code: "fictitious-code",
          },
          fakeAdapter,
        ),
      );
      assert.equal(exchanges, 1);
      const raceTicket = await prepareReconnect(request, "fixture-connection");
      const concurrent = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          completeProviderCallback(
            request,
            {
              ticketId: raceTicket.id,
              state: raceTicket.id,
              code: "fictitious-code",
            },
            fakeAdapter,
          ),
        ),
      );
      assert.equal(
        concurrent.filter((x) => x.status === "fulfilled").length,
        1,
      );
      assert.equal(exchanges, 2);
      await assert.rejects(() =>
        completeProviderCallback(
          request,
          {
            ticketId: raceTicket.id,
            state: raceTicket.id,
            code: "fictitious-code",
          },
          fakeAdapter,
        ),
      );
      assert.equal(exchanges, 2);

      const stale = await prepareReconnect(request, "fixture-connection");
      await db
        .update(integrations)
        .set({ updatedAt: new Date(Date.now() + 1000) })
        .where(eq(integrations.id, "fixture-connection"));
      await assert.rejects(() =>
        finishReconnect(request, stale.id, {
          providerType: "openai",
          config: { token: "fixture" },
        }),
      );
      await db
        .update(workflows)
        .set({
          nodes: [
            {
              id: "cross",
              data: { config: { integrationId: "fixture-connection" } },
            },
          ],
        })
        .where(eq(workflows.id, "w-wrong-owner"));
      await assert.rejects(() =>
        prepareReconnect(request, "fixture-connection"),
      );
      await db
        .update(workflows)
        .set({ nodes: [] })
        .where(eq(workflows.id, "w-wrong-owner"));
      delete process.env.CONSOLE_RECONNECT_ENABLED;
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
    }
    if (i === "one") {
      process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED = "true";
      process.env.CONSOLE_INVITATIONS_ENABLED = "true";
      const postInvite = (body: any, c = cookie) =>
        new Request("http://localhost:4300", {
          method: "POST",
          headers: { cookie: c, origin: "http://localhost:4301" },
          body: JSON.stringify(body),
        });
      const created = await inviteAction(
        postInvite({
          email: "two@fixture.local",
          role: "operator",
          teamIds: ["sales"],
          workflowIds: ["w-one"],
          canRun: false,
        }),
      );
      assert.equal(created.status, 201);
      const invitation = await created.json();
      const otherLogin = await auth.api.signInEmail({
        body: { email: "two@fixture.local", password },
        asResponse: true,
        headers: new Headers({ origin: "http://localhost:4301" }),
      });
      const otherCookie = otherLogin.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; ");
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: invitation.id }),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: invitation.id }, otherCookie),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: invitation.id }, otherCookie),
          )
        ).status,
        403,
      );
      const builderMembers = await db
        .select()
        .from(members)
        .where(eq(members.userId, "u-two"));
      assert.equal(
        builderMembers.filter((x) => x.organizationId === "one").length,
        0,
      );
      const otherRequest = new Request("http://localhost:4300", {
        headers: { cookie: otherCookie },
      });
      const orgs = await (await listOrgs(otherRequest)).json();
      assert.ok(orgs.items.some((x: any) => x.id === "one"));
      assert.equal(
        (
          await selectOrg(
            new Request("http://localhost:4300", {
              method: "POST",
              headers: { cookie: otherCookie, origin: "http://localhost:4301" },
              body: JSON.stringify({ organizationId: "one" }),
            }),
          )
        ).status,
        200,
      );
      assert.equal(
        (await consoleContext(otherRequest))?.organization.id,
        "one",
      );
      assert.deepEqual(
        (await (await bootstrap(otherRequest)).json()).workflows.map(
          (x: any) => x.id,
        ),
        ["w-one"],
      );
      assert.equal(builderMembers.length, 1);
      const createAnother = async (email: string) => {
        const r = await inviteAction(
          postInvite({
            email,
            role: "operator",
            teamIds: ["sales"],
            workflowIds: ["w-one"],
            canRun: false,
          }),
        );
        assert.equal(r.status, 201);
        return (await r.json()).id;
      };
      const cancelled = await createAnother("cancel@fixture.local");
      assert.equal(
        (await inviteAction(postInvite({ action: "cancel", id: cancelled })))
          .status,
        200,
      );
      const { consoleInvitations } = await import("@/lib/console/schema");
      assert.equal(
        (
          await db
            .select()
            .from(consoleInvitations)
            .where(eq(consoleInvitations.id, cancelled))
        )[0].status,
        "cancelled",
      );
      const again = await createAnother("two@fixture.local");
      await db
        .update(consoleInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(consoleInvitations.id, again));
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: again }, otherCookie),
          )
        ).status,
        403,
      );
      process.env.CONSOLE_ONBOARDING_TEST_ONLY = "true";
      await createAnother("new@fixture.local");
      const pendingChallenges: { id: string; token: string }[] = [];
      await assert.rejects(() =>
        registerInvitedFixture("not-invited@fixture.local", password, (c) =>
          pendingChallenges.push(c),
        ),
      );
      const registered = await registerInvitedFixture(
        "new@fixture.local",
        password,
        (c) => pendingChallenges.push(c),
      );
      assert.equal(registered.emailVerified, false);
      assert.equal(registered.delivery, "dry-run");
      const fixtureLogin = await auth.api.signInEmail({
        body: { email: "new@fixture.local", password },
        asResponse: true,
        headers: new Headers({ origin: "http://localhost:4301" }),
      });
      const fixtureCookie = fixtureLogin.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; ");
      const inviteRows = await (
        await invitationList(
          new Request("http://localhost:4300", {
            headers: { cookie: fixtureCookie },
          }),
        )
      ).json();
      const pendingNew = inviteRows.items.find(
        (x: any) => x.email === "new@fixture.local",
      );
      assert.ok(pendingNew);
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: pendingNew.id }, fixtureCookie),
          )
        ).status,
        401,
      );
      assert.equal(
        await verifyFixtureEmail(pendingChallenges[0].id, "wrong"),
        false,
      );
      assert.equal(
        await verifyFixtureEmail(
          pendingChallenges[0].id,
          pendingChallenges[0].token,
        ),
        true,
      );
      assert.equal(
        await verifyFixtureEmail(
          pendingChallenges[0].id,
          pendingChallenges[0].token,
        ),
        false,
      );
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: pendingNew.id }, fixtureCookie),
          )
        ).status,
        200,
      );
      const builderNew = await db
        .select()
        .from(members)
        .where(eq(members.userId, registered.userId));
      assert.equal(builderNew.length, 0);
      await createAnother("expired-new@fixture.local");
      await registerInvitedFixture("expired-new@fixture.local", password, (c) =>
        pendingChallenges.push(c),
      );
      const { consoleVerification } = await import("@/lib/console/schema");
      await db
        .update(consoleVerification)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(consoleVerification.id, pendingChallenges[1].id));
      assert.equal(
        await verifyFixtureEmail(
          pendingChallenges[1].id,
          pendingChallenges[1].token,
        ),
        false,
      );
      const notice = {
        organizationId: "one",
        recipient: "new@fixture.local",
        kind: "failure" as const,
        eventId: "fixture-event",
      };
      assert.deepEqual(await queueDryRunNotice(notice), {
        queued: true,
        sent: false,
      });
      assert.deepEqual(await queueDryRunNotice(notice), {
        queued: false,
        sent: false,
      });
      const { consoleOutbox } = await import("@/lib/console/schema");
      const outbox = await db.select().from(consoleOutbox);
      assert.ok(outbox.every((x) => x.status === "dry-run"));
      assert.equal(outbox.filter((x) => x.kind === "verify-email").length, 2);
      const dryItem = outbox.find((x) => x.kind === "failure")!;
      let previewCalls = 0;
      const preview = async () => {
        previewCalls++;
        return { sent: false as const };
      };
      const workerRace = await Promise.all(
        Array.from({ length: 8 }, () =>
          processDryRunOutbox(dryItem.id, preview),
        ),
      );
      assert.equal(workerRace.filter((x) => x.claimed).length, 1);
      assert.equal(previewCalls, 1);
      await queueDryRunNotice({ ...notice, eventId: "retry-fixture" });
      const retryItem = (
        await db
          .select()
          .from(consoleOutbox)
          .where(eq(consoleOutbox.dedupeKey, "one:failure:retry-fixture"))
      )[0];
      for (let attempt = 0; attempt < 3; attempt++)
        assert.equal(
          (
            await processDryRunOutbox(retryItem.id, async () => {
              throw Error("Fictitious transport failure");
            })
          ).claimed,
          true,
        );
      assert.equal(
        (await processDryRunOutbox(retryItem.id, preview)).claimed,
        false,
      );
      assert.equal(
        (
          await db
            .select()
            .from(consoleOutbox)
            .where(eq(consoleOutbox.id, retryItem.id))
        )[0].status,
        "dead-letter",
      );
      const clock = new Date("2030-01-01T00:00:00Z");
      const limits = await Promise.all(
        Array.from({ length: 8 }, () =>
          fixtureRateLimit("race-fixture", 3, 60000, clock),
        ),
      );
      assert.equal(limits.filter(Boolean).length, 3);
      await assert.rejects(() =>
        registerInvitedFixture("new@fixture.local", password, () => {}),
      );
      assert.equal(
        (
          await db
            .select()
            .from(users)
            .where(eq(users.email, "new@fixture.local"))
        ).length,
        1,
      );
      assert.equal(
        await fixtureRateLimit(
          "race-fixture",
          3,
          60000,
          new Date(clock.getTime() + 60000),
        ),
        true,
      );
      await queueDryRunNotice({ ...notice, eventId: "crash-fixture" });
      const crashItem = (
        await db
          .select()
          .from(consoleOutbox)
          .where(eq(consoleOutbox.dedupeKey, "one:failure:crash-fixture"))
      )[0];
      await db
        .update(consoleOutbox)
        .set({ status: "previewing", claimId: "interrupted", claimedAt: clock })
        .where(eq(consoleOutbox.id, crashItem.id));
      assert.equal(
        (await quarantineStaleDryRuns(new Date(clock.getTime() + 299000)))
          .length,
        0,
      );
      assert.ok(
        (await quarantineStaleDryRuns(new Date(clock.getTime() + 301000))).some(
          (x) => x.id === crashItem.id,
        ),
      );
      assert.equal(
        (await processDryRunOutbox(crashItem.id, preview)).claimed,
        false,
      );
      await assert.rejects(() =>
        reconcileDryRun(crashItem.id, "discard", "u-one", ""),
      );
      assert.deepEqual(
        await reconcileDryRun(
          crashItem.id,
          "discard",
          "u-one",
          "Inspected fictitious interrupted preview",
        ),
        { changed: true, sent: false },
      );
      assert.equal(
        (await processDryRunOutbox(crashItem.id, preview)).claimed,
        false,
      );
      assert.deepEqual(
        await reconcileDryRun(
          crashItem.id,
          "confirmed-previewed",
          "u-one",
          "No second state change allowed",
        ),
        { changed: false, sent: false },
      );

      delete process.env.CONSOLE_ONBOARDING_TEST_ONLY;
      const afterExpiry = await createAnother("two@fixture.local");
      const savedConfig = process.env.CONSOLE_ACCESS_CONFIG;
      process.env.CONSOLE_ACCESS_CONFIG = "{}";
      assert.equal(
        (
          await inviteAction(
            postInvite({ action: "accept", id: afterExpiry }, otherCookie),
          )
        ).status,
        403,
      );
      process.env.CONSOLE_ACCESS_CONFIG = savedConfig;
      delete process.env.CONSOLE_INVITATIONS_ENABLED;
      delete process.env.CONSOLE_SEPARATE_MEMBERSHIP_ENABLED;
    }
    delete process.env.CONSOLE_STORAGE_ENABLED;
    const originalConfig: string = process.env.CONSOLE_ACCESS_CONFIG!;
    process.env.CONSOLE_ACCESS_CONFIG = "{}";
    assert.equal(await consoleContext(request), null);
    process.env.CONSOLE_ACCESS_CONFIG = originalConfig;
    const originalMember = await db
      .select()
      .from(members)
      .where(eq(members.id, "m-" + i));
    await db.delete(members).where(eq(members.id, "m-" + i));
    assert.equal(await consoleContext(request), null);
    await db.insert(members).values(originalMember);
    results.push({
      notificationPreferencePersisted: true,
      workflowSettingsPolicyChecked: true,
      changeRequestPersistedAndIsolated: true,
      teamManagementPolicyChecked: true,
      explicitDryRunReconciliationNoResendChecked: true,
      atomicRateLimitWindowAndCrashQuarantineChecked: true,
      outboxConcurrentClaimAndBoundedRetryChecked: true,
      onboardingVerificationDryRunDedupeAndFakeCallbackChecked: true,
      fictitiousReconnectIdentityEncryptionReplayAndConflictChecked: true,
      consoleOnlyInvitationAcceptanceChecked: true,
      invitationCancellationExpiryAndRevokedIssuerChecked: true,
      auditOrganizationScopeChecked: true,
      teamAssignmentChoicesScoped: true,
      consoleAccessRevokedWithoutDeletingMember: true,
      organization: i,
      realAuthLogin: true,
      realDbIsolation: true,
      revokedMembershipDenied: true,
      missingGrantDenied: true,
      wrongFlowExecutionDenied: true,
      wrongOriginDenied: true,
      wrongAssignmentDenied: i === "two" ? "passed" : "not applicable",
      organizationSelection: true,
      unauthorizedOrganizationDenied: true,
      teamIsolation: true,
      historyIsolation: true,
    });
    await auth.api.signOut({ headers: new Headers({ cookie }) });
    assert.equal(await consoleContext(request), null);
  }
  assert.equal(
    await consoleContext(new Request("http://localhost:4300")),
    null,
  );
  const configBeforeDuplicate = process.env.CONSOLE_ACCESS_CONFIG!;
  const duplicateConfig = JSON.parse(configBeforeDuplicate);
  duplicateConfig.assignments.push({
    organizationId: "two",
    workflowId: "w-one",
    teamId: null,
  });
  process.env.CONSOLE_ACCESS_CONFIG = JSON.stringify(duplicateConfig);
  assert(!assignments(null).some((item) => item.workflowId === "w-one"));
  process.env.CONSOLE_ACCESS_CONFIG = configBeforeDuplicate;
  let launches = 0;
  const fixture = {
    id: "w-one",
    nodes: [
      {
        id: "manual",
        data: {
          type: "trigger",
          config: {
            triggerType: "Manual",
            inputFields: [{ key: "detail", label: "Detalle" }],
          },
        },
      },
    ],
    edges: [],
  };
  const launch = async () => {
    launches++;
  };
  const key = "fixture-concurrent-request-01";
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      reserveAndLaunch(
        "one",
        "u-one",
        fixture,
        key,
        { detail: "same input" },
        launch,
      ),
    ),
  );
  assert.equal(launches, 1);
  assert.equal(new Set(concurrent.map((r) => r.body.executionId)).size, 1);
  assert.equal(concurrent.filter((r) => r.status === 202).length, 1);
  assert.equal(concurrent.filter((r) => r.status === 200).length, 7);
  const mismatch = await reserveAndLaunch(
    "one",
    "u-one",
    fixture,
    key,
    { detail: "different" },
    launch,
  );
  assert.equal(mismatch.status, 409);
  const invalid = await reserveAndLaunch(
    "one",
    "u-one",
    fixture,
    "different-valid-key",
    {},
    launch,
  );
  assert.equal(invalid.status, 400);
  assert.equal(launches, 1);
  const failed = await reserveAndLaunch(
    "one",
    "u-one",
    fixture,
    "failed-valid-key-01",
    { detail: "test" },
    async () => {
      throw Error("fixture failure");
    },
  );
  assert.equal(failed.status, 502);
  const replay = await reserveAndLaunch(
    "one",
    "u-one",
    fixture,
    "failed-valid-key-01",
    { detail: "test" },
    launch,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, "error");
  assert.equal(launches, 1);
  results.push({
    executionStubOnly: true,
    concurrentRequests: 8,
    launches: 1,
    payloadMismatchDenied: true,
    requiredInputDenied: true,
    failureReplayDidNotRelaunch: true,
  });
  // Dedicated persistent-config fixtures, independent of earlier grant mutations.
  process.env.CONSOLE_ACCESS_CONFIG = "{}";
  process.env.CONSOLE_PERSISTENT_CONFIG_ENABLED = "true";
  await db
    .insert(users)
    .values({
      id: "persist-owner",
      name: "Persistent fixture",
      email: "persistent@fixture.local",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  await db
    .insert(organizations)
    .values({
      id: "persist-org",
      name: "Persistent fixture",
      slug: "persist-fixture",
      createdAt: now,
    });
  await db
    .insert(members)
    .values({
      id: "persist-member",
      userId: "persist-owner",
      organizationId: "persist-org",
      role: "owner",
      createdAt: now,
    });
  await db
    .insert(workflows)
    .values({
      id: "persist-flow",
      userId: "persist-owner",
      name: "Persistent flow",
      nodes: [],
      edges: [],
      active: false,
    });
  await db
    .insert(consoleSetups)
    .values({
      organizationId: "persist-org",
      ownerId: "persist-owner",
      enabled: false,
    });
  await db
    .insert(consoleAssignments)
    .values({
      organizationId: "persist-org",
      workflowId: "persist-flow",
      teamId: "sales",
      updatedBy: "persist-owner",
    });
  assert.equal(
    await effectiveGrant("persist-owner", "persist-org"),
    null,
    "Draft must not grant owner access",
  );
  assert.deepEqual(
    await runtimeAssignments(),
    [],
    "Draft assignment must stay invisible",
  );
  await db
    .update(consoleSetups)
    .set({ enabled: true })
    .where(eq(consoleSetups.organizationId, "persist-org"));
  const ownerGrant = await effectiveGrant("persist-owner", "persist-org");
  assert.equal(ownerGrant?.role, "owner");
  assert.equal(ownerGrant?.canRun, false);
  assert.equal(
    (await visibleWorkflows(ownerGrant!, null))[0]?.id,
    "persist-flow",
  );
  process.env.CONSOLE_ACCESS_CONFIG = JSON.stringify({
    assignments: [
      { organizationId: "other-org", workflowId: "persist-flow", teamId: null },
    ],
  });
  assert.deepEqual(
    await runtimeAssignments(),
    [],
    "Persistent/env tenant collision must fail closed",
  );
  process.env.CONSOLE_ACCESS_CONFIG = "{}";
  await db
    .update(members)
    .set({ role: "member" })
    .where(eq(members.id, "persist-member"));
  assert.equal(
    await effectiveGrant("persist-owner", "persist-org"),
    null,
    "Owner removal must immediately revoke implicit grant",
  );
  await db
    .update(members)
    .set({ role: "owner" })
    .where(eq(members.id, "persist-member"));
  process.env.CONSOLE_PERSISTENT_CONFIG_ENABLED = "false";
  assert.equal(
    await effectiveGrant("persist-owner", "persist-org"),
    null,
    "Flag off must remove persistent grant",
  );
  assert.deepEqual(await runtimeAssignments(), []);
  results.push({
    persistentDraftNoAccess: true,
    enabledFixtureReadOnlyOwner: true,
    tenantCollisionClosed: true,
    ownerRemovalRevokes: true,
    persistentFlagOffClosed: true,
  });
  console.log(
    JSON.stringify(
      {
        scope:
          "real Better Auth and PostgreSQL, isolated local fixtures, no workflow execution",
        results,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
