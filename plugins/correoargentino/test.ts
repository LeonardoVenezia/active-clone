import { getCorreoToken, hasCorreoCredentials } from "./api";

export async function testCorreoArgentino(credentials: Record<string, string>) {
  try {
    if (!hasCorreoCredentials(credentials)) {
      return { success: false, error: "User, password and customer ID are required" };
    }
    await getCorreoToken(credentials);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
