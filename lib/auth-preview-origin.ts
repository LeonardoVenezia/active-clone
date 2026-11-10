// Only this preview alias was approved for cookie-bearing auth requests.
// Do not derive trust from request headers or allow other Vercel hosts.
export const APPROVED_PREVIEW_AUTH_ORIGIN =
  "https://active-clone-git-soluciones-c-911406-leonardo-venezias-projects.vercel.app";

export function approvedPreviewAuthOrigins(environment: string | undefined) {
  return environment === "preview" ? [APPROVED_PREVIEW_AUTH_ORIGIN] : [];
}
