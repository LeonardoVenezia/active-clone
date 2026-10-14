import { getEnviopackToken, hasEnviopackCredentials } from "./api";

export async function testEnviopack(credentials: Record<string, string>) {
  try {
    if (!hasEnviopackCredentials(credentials)) {
      return { success: false, error: "ENVIOPACK_API_KEY and ENVIOPACK_SECRET_KEY are required" };
    }
    await getEnviopackToken(credentials);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
