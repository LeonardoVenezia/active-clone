
// Client-safe failure guidance. The raw execution error never leaves the
// server: it can carry URLs, headers or provider payloads. Map known shapes
// to a plain next step; anything unknown gets the generic fallback.
export function failureHint(
  status: string,
  rawError: string | null,
): string | null {
  if (status !== "error" || !rawError) return null;
  const e = rawError.toLowerCase();
  if (
    /http request failed with status (401|403|400|404)/.test(e) ||
    e.includes("invalid") ||
    e.includes("unauthorized") ||
    e.includes("credential")
  )
    return "El servicio rechazó la conexión. Revisá la credencial en Conexiones o pedile a tu agencia que la verifique.";
  if (e.includes("timeout") || e.includes("timed out"))
    return "El servicio tardó demasiado en responder. Probá de nuevo más tarde.";
  if (e.includes("network") || e.includes("econn") || e.includes("dns"))
    return "No se pudo llegar al servicio. Probá de nuevo más tarde.";
  return "No se pudo completar. Si se repite, avisale a tu agencia.";
}
