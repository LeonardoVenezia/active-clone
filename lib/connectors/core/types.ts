// App-owned integration types. Nothing in this file may mention a vendor.
export type PermissionId = string; // e.g. "mail.read", "sheets.readwrite"
export type Risk = "low" | "medium" | "high";
export type Permission = {
  id: PermissionId;
  label: string; // plain words shown before consent
  risk: Risk;
};
export type Preset = {
  id: string;
  toolkitId: string;
  title: string;
  grants: Permission[];
  doesNotGrant: string[]; // plain-language limits shown before consent
  consentHint: string; // exact thing to tick/check on the provider's consent screen
  notes?: string;
};
export type Toolkit = {
  id: string;
  name: string;
  description: string;
  logoUrl: string | null;
  categories: string[];
  authKind: "oauth" | "apikey" | "none" | "other";
  reviewed: boolean; // has a vetted minimal preset; Connect is only enabled when true
  preset: Preset | null;
};
export type ToolkitPage = { items: Toolkit[]; nextCursor: string | null; total: number | null };
export type ConnectionStatus = "pending" | "active" | "needs_attention" | "failed";
export type Verification = {
  ok: boolean;
  checked: boolean; // false when the provider did not report granted permissions
  granted: PermissionId[];
  missing: { id: PermissionId; label: string }[];
  unexpected: string[]; // broader-than-preset grants, as reported by the provider
};
export type Connection = {
  id: string;
  toolkitId: string;
  status: ConnectionStatus;
  label: string;
  verification: Verification | null;
  recovery: string | null; // guided next step when status is needs_attention
  usedBy: string[]; // names of app flows that use this connection
};
export type TestResult = { ok: boolean; message: string; checkedAt: string };
export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
export type TriggerRef = { triggerId: string };
export type NormalizedEvent = {
  kind: string; // app event name, e.g. "mail.received"
  userId: string;
  connectionId: string;
  triggerId: string;
  itemId: string | null;
};
