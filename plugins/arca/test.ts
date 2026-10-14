import type { ArcaCredentials } from "./credentials";
import { createEngine, hasArcaCredentials } from "./engine";

export async function testArca(credentials: Record<string, string>) {
  try {
    const typed = credentials as ArcaCredentials;
    if (!hasArcaCredentials(typed)) {
      return {
        success: false,
        error:
          "ARCA_TAX_ID, ARCA_CERTIFICATE_PEM and ARCA_PRIVATE_KEY_PEM are required",
      };
    }
    // Reads the WSFE server status: needs a valid WSAA login (certificate +
    // key + service authorization) but issues nothing.
    const engine = createEngine(typed);
    await engine.wsfe.getServerStatus();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
