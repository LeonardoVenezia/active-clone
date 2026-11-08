import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption configuration for integration credentials.
// Pure module (no server-only, no db): unit tests import it directly.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const ENCRYPTION_KEY_ENV = "INTEGRATION_ENCRYPTION_KEY";

/**
 * Get the encryption key from the environment.
 * Key must be a 32-byte hex string (64 characters).
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env[ENCRYPTION_KEY_ENV];

  if (!keyHex) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} environment variable is required for encrypting integration credentials`
    );
  }

  if (keyHex.length !== 64) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} must be a 64-character hex string (32 bytes)`
    );
  }

  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt sensitive data
 * Returns a string in format: iv:authTag:encryptedData (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Return format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt encrypted data
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * True when this environment's key can decrypt the stored ciphertext.
 * False means the config was encrypted elsewhere (another environment's key):
 * overwriting it here would re-encrypt it with the wrong key and make it
 * unreadable where it was created.
 */
export function canDecryptHere(ciphertext: string): boolean {
  try {
    decrypt(ciphertext);
    return true;
  } catch {
    return false;
  }
}

/**
 * Thrown when a mutation would overwrite a config this environment cannot
 * decrypt. The message is user-facing (API 409): it must explain what
 * happened and that nothing was saved.
 */
export class IntegrationConfigUnreadableError extends Error {
  constructor() {
    super(
      "Esta conexión se creó cifrada con la clave de otro entorno. Editarla desde acá la haría ilegible en su entorno original, así que no se guardó ningún cambio. Editála desde el entorno donde fue creada."
    );
    this.name = "IntegrationConfigUnreadableError";
  }
}
