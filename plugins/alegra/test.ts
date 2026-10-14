import { alegraGet, hasAlegraCredentials } from "./api";

export async function testAlegra(credentials: Record<string, string>) {
  try {
    if (!hasAlegraCredentials(credentials)) {
      return { success: false, error: "ALEGRA_EMAIL and ALEGRA_TOKEN are required" };
    }
    await alegraGet(credentials, "company");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
