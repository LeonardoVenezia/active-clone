import { type ModelMessage, modelMessageSchema } from "ai";

// Messages a pass returned (assistant tool calls + tool results) are re-sent to the model in the next pass. The SDK only accepts JSON values
// there: an `undefined` property inside a tool result (e.g. { schedule: undefined }) makes the next call fail with "Invalid prompt: The messages
// must be a ModelMessage[]". We make them JSON-safe (undefined props dropped, like the wire format does) and then VALIDATE every message with
// the SDK's own schema. If one is still invalid we throw naming the message index and schema path (no content), instead of casting.
export function toModelMessages(raw: unknown[]): ModelMessage[] {
  const safe = JSON.parse(JSON.stringify(raw)) as unknown[];
  const bad: string[] = [];
  safe.forEach((m, i) => {
    const r = modelMessageSchema.safeParse(m);
    if (!r.success) bad.push(`#${i} ${(m as { role?: string })?.role}: ${r.error.issues.slice(0, 2).map((x) => x.path.join(".") + " " + x.code).join("; ")}`);
  });
  if (bad.length) throw new Error(`pass returned messages the SDK rejects (${bad.slice(0, 3).join(" | ")})`);
  return safe as ModelMessage[];
}
