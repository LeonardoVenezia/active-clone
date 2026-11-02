export async function workflowAccessFacts(_r: Request, _id: string) { return { facts: (globalThis as any).__facts, nodes: (globalThis as any).__nodes, userId: "u" }; }
export async function orgForWorkflowRead() { return null; }
