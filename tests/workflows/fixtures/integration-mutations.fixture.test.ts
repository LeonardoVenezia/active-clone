// In-memory fixture, never loads account credentials or contacts a database.
// Invoked with react-server condition solely to allow server-only imports.
import assert from "node:assert/strict";
import test from "node:test";
import {
  decrypt,
  encrypt,
  IntegrationConfigUnreadableError,
} from "../../../lib/integrations/crypto";

test("guarded database mutations with in-memory transaction fixture", async () => {
  const keyA = "a".repeat(64);
  const keyB = "b".repeat(64);
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/no_database";
  process.env.INTEGRATION_ENCRYPTION_KEY = keyA;
  const original = {
    id: "fixture",
    userId: "fixture-owner",
    name: "Original",
    type: "database",
    config: encrypt('{"url":"fixture-only"}'),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    isManaged: false,
  };
  let row: typeof original | null = { ...original };
  let writes = 0;
  let locks = 0;
  const fixtureTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: (mode: string) => {
            assert.equal(mode, "update");
            locks += 1;
            return Promise.resolve(row ? [{ ...row }] : []);
          },
        }),
      }),
    }),
    update: () => {
      writes += 1;
      return {
        set: (patch: Partial<typeof original>) => ({
          where: () => ({
            returning: () => {
              if (!row) {
                return Promise.resolve([]);
              }
              row = { ...row, ...patch };
              return Promise.resolve([row]);
            },
          }),
        }),
      };
    },
    delete: () => {
      writes += 1;
      return {
        where: () => ({
          returning: () => {
            const previous = row;
            row = null;
            return Promise.resolve(previous ? [previous] : []);
          },
        }),
      };
    },
  };
  Reflect.set(globalThis, "db", {
    transaction: async <T>(
      operation: (tx: typeof fixtureTx) => Promise<T>
    ): Promise<T> => await operation(fixtureTx),
  });

  const { updateIntegration, deleteIntegration } = await import(
    "../../../lib/db/integrations"
  );
  process.env.INTEGRATION_ENCRYPTION_KEY = keyB;
  for (const operation of [
    () => updateIntegration("fixture", "fixture-owner", { config: {} }),
    () => updateIntegration("fixture", "fixture-owner", { name: "Changed" }),
    () => deleteIntegration("fixture", "fixture-owner"),
  ]) {
    await assert.rejects(operation, IntegrationConfigUnreadableError);
    assert.deepEqual(row, original);
    assert.equal(
      writes,
      0,
      "no write builder may be called on an unreadable row"
    );
  }
  process.env.INTEGRATION_ENCRYPTION_KEY = keyA;
  row = { ...original, config: encrypt("not JSON") };
  await assert.rejects(
    () => updateIntegration("fixture", "fixture-owner", { config: {} }),
    IntegrationConfigUnreadableError
  );
  assert.equal(writes, 0, "invalid JSON must not be silently replaced by {}");

  row = null;
  assert.equal(
    await updateIntegration("missing", "fixture-owner", { config: {} }),
    null
  );
  assert.equal(await deleteIntegration("missing", "fixture-owner"), false);
  assert.equal(writes, 0);
  row = { ...original };
  const updated = await updateIntegration("fixture", "fixture-owner", {
    config: { url: "fixture-new" },
    name: "New",
  });
  assert.equal(updated?.name, "New");
  assert.deepEqual(JSON.parse(decrypt(row.config)), { url: "fixture-new" });
  assert.equal(writes, 1);
  assert.equal(await deleteIntegration("fixture", "fixture-owner"), true);
  assert.equal(writes, 2);
  assert.equal(
    locks,
    8,
    "every mutation must lock its owned row before validation"
  );
  console.log(
    "8 mutation checks passed; unreadable configs never reached a write"
  );
});
