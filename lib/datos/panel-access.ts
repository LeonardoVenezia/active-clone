export type PanelAccessState = "checking" | "signin" | "forbidden" | null;

/** A denial never reveals whether the workflow or company exists. */
export function panelAccessState(
  denied: boolean,
  sessionPending: boolean,
  signedIn: boolean
): PanelAccessState {
  if (!denied) {
    return null;
  }
  if (sessionPending) {
    return "checking";
  }
  return signedIn ? "forbidden" : "signin";
}

/** Authorization failures need a changed session or an explicit retry, not polling. */
export function pausePanelPolling(status: number): boolean {
  return status === 401 || status === 403;
}

export function panelEnabledMessage(enabled: unknown): string {
  return enabled === false ? "Los datos todavía no están habilitados." : "";
}
