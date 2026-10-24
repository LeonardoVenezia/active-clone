// Offline stub for the generated step registry: handlers are installed by the test through globalThis.__H
export const getActionLabel = (a: string) => a;
export const getStepImporter = (a: string) => ((globalThis as any).__H?.[a] ? { importer: async () => ({ run: (globalThis as any).__H[a] }), stepFunction: "run" } : undefined);
