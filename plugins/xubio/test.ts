import { getXubioToken, hasXubioCredentials } from "./api";

export async function testXubio(credentials: Record<string, string>) {
  try {
    if (!hasXubioCredentials(credentials)) {
      return { success: false, error: "XUBIO_CLIENT_ID and XUBIO_SECRET_ID are required" };
    }
    await getXubioToken(credentials);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
