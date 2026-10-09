import "server-only";
import { Resend } from "resend";

/** Fail closed: never log reset URLs/tokens or pretend email was delivered. */
export async function sendPasswordResetEmail(email: string, url: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Password reset email is not configured");
  }
  const result = await new Resend(apiKey).emails.send({
    from,
    to: email,
    subject: "Reset your Active-clone password",
    text: `Reset your password using this link:\n${url}\n\nIf you did not request this change, ignore this email.`,
  });
  if (result.error) {
    throw new Error("Password reset email could not be sent");
  }
}
