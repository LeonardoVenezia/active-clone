import "server-only";
// Low-level transport preparation only. No HTTP route, worker or env-key lookup.
// User-approved recipient/content and an explicitly enabled runtime are required
// before a future orchestrator may pass an envelope here. The adapter grants none.
export type MailEnvelope = {
  id: string;
  to: string;
  subject: string;
  text: string;
};
export type DeliveryOutcome =
  | { status: "accepted"; providerId: string }
  | { status: "rejected"; retryable: boolean }
  | { status: "unknown" };
type Http = (url: string, init: RequestInit) => Promise<Response>;
export function resendConsoleTransport(
  settings: { enabled: boolean; apiKey: string; from: string },
  http: Http,
) {
  return {
    async deliver(message: MailEnvelope): Promise<DeliveryOutcome> {
      if (!settings.enabled || !settings.apiKey || !settings.from)
        throw Error("Console mail transport disabled");
      if (
        !/^[A-Za-z0-9_-]{16,128}$/.test(message.id) ||
        !/^\S+@\S+\.\S+$/.test(message.to) ||
        /[\r\n]/.test(message.subject) ||
        !message.subject ||
        message.subject.length > 200 ||
        !message.text ||
        message.text.length > 20000
      )
        throw Error("Invalid mail envelope");
      try {
        const response = await http("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "console/" + message.id,
          },
          body: JSON.stringify({
            from: settings.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
          }),
          signal: AbortSignal.timeout(15000),
        });
        // Never retry ambiguous failures automatically, including malformed success.
        if (
          response.status >= 500 ||
          response.status === 409 ||
          response.status === 408
        )
          return { status: "unknown" };
        if (!response.ok)
          return { status: "rejected", retryable: response.status === 429 };
        const value = await response.json();
        return typeof value.id === "string" && value.id
          ? { status: "accepted", providerId: value.id }
          : { status: "unknown" };
      } catch {
        return { status: "unknown" };
      }
    },
  };
}
