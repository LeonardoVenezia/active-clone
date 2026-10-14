import { hasZipnovaCredentials, zipnovaRequest } from "./api";

export async function testZipnova(credentials: Record<string, string>) {
  try {
    if (!hasZipnovaCredentials(credentials)) {
      return { success: false, error: "ZIPNOVA_API_TOKEN, ZIPNOVA_API_SECRET and ZIPNOVA_ACCOUNT_ID are required" };
    }
    // A quote with an empty body is rejected with 400/422 once credentials are accepted;
    // only 401/403 mean the credentials or account are wrong.
    try {
      await zipnovaRequest(credentials, "POST", "/shipments/quote", { account_id: Number(credentials.ZIPNOVA_ACCOUNT_ID) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Invalid Zipnova|HTTP 401|HTTP 403/.test(message)) return { success: false, error: message };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
