import { graphFetch } from "./api";

export async function testWhatsApp(credentials: Record<string, string>) {
  try {
    const accessToken = credentials.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = credentials.WHATSAPP_PHONE_NUMBER_ID;
    if (!(accessToken && phoneNumberId)) {
      return {
        success: false,
        error: "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required",
      };
    }
    // Reading the phone number object proves token and ID belong together.
    const result = await graphFetch(
      accessToken,
      `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`
    );
    return result.ok ? { success: true } : { success: false, error: result.error };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
