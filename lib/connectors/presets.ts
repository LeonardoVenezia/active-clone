import type { Preset } from "./core/types";
// Reviewed, minimal permission presets. A toolkit without a preset here cannot be connected from the UI.
// Never fall back to provider defaults: they include send/edit/delete permissions.
export const PRESETS: Record<string, Preset> = {
  gmail: {
    id: "gmail.read", toolkitId: "gmail", title: "Read Gmail",
    grants: [{ id: "mail.read", label: "Read your Gmail messages", risk: "medium" }],
    doesNotGrant: ["Sending email", "Editing or deleting email", "Drive, Calendar or Contacts"],
    consentHint: "On Google's screen, keep the Gmail read-only permission ticked.",
  },
  outlook: {
    id: "outlook.read", toolkitId: "outlook", title: "Read Outlook mail",
    grants: [{ id: "mail.read", label: "Read your Outlook mail", risk: "medium" }],
    doesNotGrant: ["Sending email", "Editing or deleting email", "Calendar or Contacts"],
    consentHint: "On Microsoft's screen, accept 'Read your mail'.",
  },
  googlesheets: {
    id: "googlesheets.rw", toolkitId: "googlesheets", title: "Google Sheets (read and write)",
    grants: [{ id: "sheets.readwrite", label: "See, edit, create and delete your Google Sheets spreadsheets", risk: "high" }],
    doesNotGrant: ["Drive files other than spreadsheets", "Gmail", "Calendar"],
    consentHint: "On Google's screen, tick the circle next to 'See, edit, create and delete all your Google Sheets spreadsheets' before Continue.",
    notes: "Google grants this for all your spreadsheets. The app only ever writes to the one pinned Mail log sheet.",
  },
};
export function presetFor(toolkitId: string): Preset | null { return PRESETS[toolkitId] ?? null; }
