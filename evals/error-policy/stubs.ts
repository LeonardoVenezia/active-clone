export const calls: any[] = [];
export const completions: any[] = [];
export const triggerStep = async (input: any) => {
  if (input._workflowComplete) completions.push(input._workflowComplete);
  if (input.triggerData?.fail) return { success: false, error: "trigger failed" };
  return { success: true, data: input.triggerData };
};
export const joinStep = async ({ result }: any) => result;
export const markExecutionStartErrorStep = async () => {};
export const recordPendingApprovalStep = async () => {};
export const recordApprovalDecisionStep = async () => {};
export const createHook = () => Promise.resolve({ approved: false });
export const sleep = (ms: number) => new Promise(r => setTimeout(r, Math.min(ms, 20)));
export const getActionLabel = (s: string) => s;
export const action = async (input: any) => {
  calls.push(input);
  if (input._context.nodeType === "Throw") throw Error("thrown failure");
  if (input._context.nodeType === "Fail") return { success: false, error: { message: "returned failure" } };
  if (input._context.nodeType === "Wait") await new Promise(r => setTimeout(r, 50));
  if (input._context.nodeType === "Condition") return { condition: input.condition };
  return { data: input, success: true };
};
export const getStepImporter = (type: string) => type === "Unknown" ? undefined : ({ importer: async () => ({ action }), stepFunction: "action" });
export const conditionStep = action;
export const databaseQueryStep = action;
export const httpRequestStep = action;
export const formulaStep = action;
export const frontendStep = action;
export const datosStep = action;
