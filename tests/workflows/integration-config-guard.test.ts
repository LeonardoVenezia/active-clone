// Suite "soluciones" (gate CI del pack, como las demás de tests/workflows).
// Guard anti re-cifrado cruzado de conexiones: una config cifrada con la clave
// de OTRO entorno no se puede sobrescribir acá (la haría ilegible en su
// origen). Contratos puros sobre @/lib/integrations/crypto, sin db ni red.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertIntegrationConfigReadable,
  canDecryptHere,
  decrypt,
  encrypt,
  IntegrationConfigUnreadableError,
} from "../../lib/integrations/crypto";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function withKey(key: string, fn: () => void) {
  const prev = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = key;
  try {
    fn();
  } finally {
    if (prev === undefined) {
      Reflect.deleteProperty(process.env, "INTEGRATION_ENCRYPTION_KEY");
    } else {
      process.env.INTEGRATION_ENCRYPTION_KEY = prev;
    }
  }
}

test("encrypt/decrypt round-trip con la misma clave", () => {
  withKey(KEY_A, () => {
    const ciphertext = encrypt('{"token":"secreto"}');
    assert.equal(decrypt(ciphertext), '{"token":"secreto"}');
    assert.equal(canDecryptHere(ciphertext), true);
  });
});

test("config cifrada con otra clave NO se descifra acá: el guard la detecta", () => {
  let cipher = "";
  withKey(KEY_A, () => {
    cipher = encrypt('{"token":"secreto"}');
  });
  withKey(KEY_B, () => {
    assert.equal(canDecryptHere(cipher), false);
    assert.throws(() => decrypt(cipher));
  });
});

test("texto que no es ciphertext válido también se detecta como no descifrable", () => {
  withKey(KEY_A, () => {
    assert.equal(canDecryptHere("no-es-ciphertext"), false);
    assert.equal(canDecryptHere(""), false);
  });
});

test("el error del guard explica qué pasó y que no se guardó nada", () => {
  const err = new IntegrationConfigUnreadableError();
  assert.equal(err.name, "IntegrationConfigUnreadableError");
  assert.match(err.message, /este entorno/);
  assert.match(err.message, /no se guardó ningún cambio/i);
  assert.match(err.message, /proteger los datos originales/);
});

test("missing key and invalid decrypted JSON both block mutation", () => {
  withKey(KEY_A, () => {
    assert.throws(
      () => assertIntegrationConfigReadable(encrypt("[]")),
      IntegrationConfigUnreadableError
    );
    assert.throws(
      () => assertIntegrationConfigReadable(encrypt("not JSON")),
      IntegrationConfigUnreadableError
    );
    const ciphertext = encrypt("{}");
    Reflect.deleteProperty(process.env, "INTEGRATION_ENCRYPTION_KEY");
    assert.throws(
      () => assertIntegrationConfigReadable(ciphertext),
      IntegrationConfigUnreadableError
    );
  });
});

test("actual update/delete functions reject before writes; readable updates still work", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/workflows/fixtures/integration-mutations.fixture.test.ts",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://127.0.0.1:1/no_database",
      },
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /8 mutation checks passed/);
});
