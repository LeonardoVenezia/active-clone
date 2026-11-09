import { frontendViewFromNodes } from "../datos/frontend";
import { solutionConfigFromNodes } from "../soluciones/config";
import { parseSolutionViewKind } from "../soluciones/views";
import {
  type Assignment,
  type ConsoleGrant,
  canExecute,
  canView,
} from "./policy";
import { isManualConsoleWorkflow } from "./workflow-summary";

type Flow = { id: string; nodes: unknown; active: boolean };
type Inputs = {
  grant: ConsoleGrant | null;
  flow: Flow | null;
  assignment: Assignment | null;
  dataOrganizationId: string | null;
  dataEnabled: boolean;
  executionEnabled: boolean;
};
/** Pure authorization/shape decision. Reading a panel never creates a grant or activates a workflow. */
export function consolePanelDecision(input: Inputs) {
  const { grant, flow, assignment } = input;
  if (!grant) return { status: 401 as const };
  if (
    !(flow && assignment) ||
    flow.id !== assignment.workflowId ||
    !canView(grant, assignment) ||
    input.dataOrganizationId !== grant.organizationId
  )
    return { status: 403 as const };
  if (!input.dataEnabled) return { status: 503 as const };
  const view = frontendViewFromNodes(flow.nodes),
    solution = solutionConfigFromNodes(flow.nodes);
  if (!(view && parseSolutionViewKind(solution?.frontend?.view)))
    return { status: 404 as const };
  return {
    status: 200 as const,
    view: { ...view, solution: solution?.frontend },
    solution,
    canRun:
      input.executionEnabled &&
      canExecute(
        grant,
        assignment,
        isManualConsoleWorkflow(flow.nodes),
        flow.active
      ),
  };
}
