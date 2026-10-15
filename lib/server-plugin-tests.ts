import "server-only";

// Connection tests that need server-only code (database, native SDKs). They live
// here, not in the plugin's testConfig, so client bundles that import the plugin
// registry never reach server-only modules. The test routes check this map first.
export const SERVER_PLUGIN_TESTS: Record<
  string,
  () => Promise<(credentials: Record<string, string>) => Promise<{ success: boolean; error?: string }>>
> = {
  arca: async () => (await import("@/plugins/arca/test")).testArca,
};
