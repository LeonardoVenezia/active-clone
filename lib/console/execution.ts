import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutions } from "@/lib/db/schema";
import {
  manualInputConfigProblems,
  manualInputFields,
  prepareInput,
} from "@/lib/manual-input";
type Flow = { id: string; nodes: any[]; edges: any[] };
type Launch = (
  executionId: string,
  workflow: Flow,
  input: Record<string, string>,
) => Promise<void>;
// The primary key is the durable deduplication boundary. A crash after reservation
// leaves pending work for investigation, never an automatic second paid execution.
export async function reserveAndLaunch(
  orgId: string,
  userId: string,
  flow: Flow,
  key: unknown,
  raw: unknown,
  launch: Launch,
) {
  if (typeof key !== "string" || !/^[-a-zA-Z0-9_]{16,128}$/.test(key))
    return {
      status: 400,
      body: {
        error: "La solicitud necesita una clave de idempotencia válida.",
      },
    };
  if (manualInputConfigProblems(flow.nodes).length)
    return {
      status: 400,
      body: {
        error: "El formulario manual necesita revisión. No se ejecutó nada.",
      },
    };
  const prepared = prepareInput(manualInputFields(flow.nodes), raw);
  if (prepared.missing.length || prepared.tooLong.length)
    return {
      status: 400,
      body: {
        error:
          "Revisá los campos requeridos y su longitud. No se ejecutó nada.",
      },
    };
  const id =
    "console_" +
    createHash("sha256")
      .update(JSON.stringify([orgId, userId, flow.id, key]))
      .digest("hex");
  const inserted = await db
    .insert(workflowExecutions)
    .values({
      id,
      workflowId: flow.id,
      userId,
      status: "pending",
      input: prepared.input,
    })
    .onConflictDoNothing()
    .returning({ id: workflowExecutions.id });
  if (!inserted.length) {
    const prior = await db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.id, id),
    });
    if (
      !prior ||
      JSON.stringify(Object.entries(prior.input || {}).sort()) !==
        JSON.stringify(Object.entries(prepared.input).sort())
    )
      return {
        status: 409,
        body: {
          error:
            "Esta solicitud ya se usó con otros datos. No se inició otra corrida.",
        },
      };
    return {
      status: 200,
      body: { executionId: id, status: prior.status, replayed: true },
    };
  }
  try {
    await launch(id, flow, prepared.input);
    return {
      status: 202,
      body: { executionId: id, status: "pending", replayed: false },
    };
  } catch {
    await db
      .update(workflowExecutions)
      .set({
        status: "error",
        error:
          "No se pudo confirmar el inicio desde la consola. No reintentar automáticamente.",
        completedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, id));
    return {
      status: 502,
      body: {
        executionId: id,
        error:
          "No se pudo confirmar el inicio. Revisá el historial antes de intentar otra solicitud.",
      },
    };
  }
}
