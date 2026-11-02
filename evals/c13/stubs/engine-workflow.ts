export const sleep = (ms: number) => { const k = (globalThis as any).__sleepScale; return k === undefined ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms * k)); };
export const createHook = (_o: any) => { (globalThis as any).__hookMeta?.push(_o?.metadata); return new Promise((res) => setTimeout(() => res({ approved: true }), (globalThis as any).__approveDelay ?? 10)); };
