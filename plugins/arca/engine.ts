import "server-only";

import {
  type ArcaClient,
  createArcaClient,
  createPostgresStore,
} from "facturas";
import postgres from "postgres";
import type { ArcaCredentials } from "./credentials";

/**
 * ARCA engine boundary.
 *
 * The rest of the app talks to ARCA ONLY through this file. Today it wraps
 * the open source `facturas` SDK (Apache-2.0, github.com/LaPyme/facturas),
 * which speaks directly to ARCA's web services (WSAA login, Padron, WSFE)
 * with OUR certificate: no hosted service in between. If we ever replace it
 * with our own WSAA/WSFE code, only this file changes.
 *
 * WHAT THE USER MUST DO IN ARCA (once per CUIT and per environment). The
 * environments are separate: a homologation (test) certificate does not work
 * in production.
 *  Homologation (test), done by a person with clave fiscal level 2+:
 *   1. auth.afip.gob.ar -> Mis Servicios -> "WSASS - Autogestion Certificados
 *      Homologacion" (if missing: Administrador de Relaciones -> Adherir
 *      Servicio -> ARCA -> Servicios Interactivos -> WSASS; log out and in).
 *   2. Generate a key + CSR: `npx facturas init` (prints the steps).
 *   3. WSASS -> "Nuevo Certificado": paste the CSR. The PEM certificate
 *      appears on the same page.
 *   4. WSASS -> "Crear autorizacion a servicio": pick the alias, the CUIT and
 *      service "wsfe - Facturacion Electronica". For taxpayer lookups, also
 *      authorize the Padron service (ws_sr_padron_a5; a13 for document lookup).
 *   5. Create a sales point of type "RECE para aplicativo y Web Services"
 *      (or the Monotributo web services type) in "Administracion de Puntos
 *      de Venta y Domicilios".
 *  Production: "Administracion de Certificados Digitales" (alias + CSR),
 *  download the CRT, then Administrador de Relaciones -> Nueva Relacion ->
 *  Webservices -> Facturacion Electronica -> the alias. Not used until Leo
 *  decides: this plugin defaults to environment "test".
 *  Docs: https://facturas-sdk.dev/getting-started/arca-setup
 */

export type ArcaEnvironment = "test" | "production";

export function hasArcaCredentials(credentials: ArcaCredentials): boolean {
  return Boolean(
    credentials.ARCA_TAX_ID &&
      credentials.ARCA_CERTIFICATE_PEM &&
      credentials.ARCA_PRIVATE_KEY_PEM
  );
}

export function arcaEnvironment(credentials: ArcaCredentials): ArcaEnvironment {
  return credentials.ARCA_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "production"
    : "test";
}

// Reservations of voucher numbers must survive restarts (serverless), so
// they live in our Postgres table `arca_store` (migration 0008).
const globalForArca = globalThis as unknown as {
  arcaStoreClient: ReturnType<typeof postgres> | undefined;
};

function getStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  globalForArca.arcaStoreClient ??= postgres(connectionString, { max: 2 });
  const client = globalForArca.arcaStoreClient;
  return createPostgresStore({
    query: (text, params) =>
      client.unsafe(text, (params ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]>,
    table: "arca_store",
  });
}

// PEMs pasted into a single-line field often arrive with literal "\n".
function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

export function createEngine(credentials: ArcaCredentials): ArcaClient {
  return createArcaClient({
    taxId: (credentials.ARCA_TAX_ID ?? "").replace(/\D/g, ""),
    certificatePem: normalizePem(credentials.ARCA_CERTIFICATE_PEM ?? ""),
    privateKeyPem: normalizePem(credentials.ARCA_PRIVATE_KEY_PEM ?? ""),
    environment: arcaEnvironment(credentials),
    store: getStore(),
  });
}
