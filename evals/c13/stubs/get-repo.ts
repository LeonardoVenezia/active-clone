import { memoryRepo } from "../../../lib/datos/core";
const repo = (globalThis as any).__repo ?? ((globalThis as any).__repo = memoryRepo());
export const pgDatosRepo = repo;
