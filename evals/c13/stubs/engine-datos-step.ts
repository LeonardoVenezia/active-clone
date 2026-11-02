// Offline stub of lib/steps/datos: records exactly what the executor hands the step.
export async function datosStep(input: any) {
  ((globalThis as any).__datosSeen ??= []).push(input);
  return { success: true, record: null };
}
