export const sleep = async (_ms: number) => {};
export const createHook = (_o: any) => { (globalThis as any).__hookMeta?.push(_o?.metadata); return new Promise((res) => setTimeout(() => res({ approved: true }), (globalThis as any).__approveDelay ?? 10)); };
