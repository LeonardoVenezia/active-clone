import { ReactFlowProvider } from "@xyflow/react";
import { createStore, Provider } from "jotai";
import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/new-workflow/page";
import { OverlayProvider } from "../../components/overlays/overlay-provider";
import { PanelInner } from "../../components/workflow/node-config-panel";
import { WorkflowCanvas } from "../../components/workflow/workflow-canvas";
import { api } from "../../lib/api-client";
import {
  canEditWorkflowAtom,
  currentWorkflowIdAtom,
  edgesAtom,
  isWorkflowOwnerAtom,
  nodesAtom,
  rightPanelWidthAtom,
  selectedNodeAtom,
  type WorkflowNode,
} from "../../lib/workflow-store";

const w = window as unknown as {
  qaRouter: {
    replace: (url: string) => void;
    push: () => void;
    refresh: () => void;
  };
  redirects: string[];
  qa: unknown;
};
const store = createStore();
const old: WorkflowNode[] = [
  {
    id: "old-trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { label: "", type: "trigger", config: { triggerType: "Manual" } },
  },
  {
    id: "old-action",
    type: "action",
    position: { x: 250, y: 0 },
    data: {
      label: "",
      type: "action",
      config: {
        actionType: "Datos",
        operation: "read",
        collection: "old",
        key: "old",
      },
    },
  },
];
const mode = new URLSearchParams(location.search).get("mode");
store.set(
  nodesAtom,
  mode === "home"
    ? old
    : ([
        {
          id: "action",
          type: "action",
          position: { x: 0, y: 0 },
          data: { type: "action", config: {} },
        },
      ] as WorkflowNode[])
);
store.set(
  edgesAtom,
  mode === "home"
    ? [{ id: "old-edge", source: "old-trigger", target: "old-action" }]
    : []
);
store.set(currentWorkflowIdAtom, "old-workflow");
store.set(selectedNodeAtom, mode === "home" ? null : "action");
store.set(isWorkflowOwnerAtom, true);
store.set(canEditWorkflowAtom, true);
w.qaRouter = {
  replace: (url: string) => {
    w.redirects.push(url);
  },
  push: () => {
    /* No navigation in fixture. */
  },
  refresh: () => {
    /* No refresh in fixture. */
  },
};
w.redirects = [];
w.qa = {
  selectAction: () => store.set(selectedNodeAtom, "action"),
  save: () =>
    api.workflow.update("qa-local", {
      nodes: store.get(nodesAtom),
      edges: store.get(edgesAtom),
    }),
  state: () => ({
    nodes: store.get(nodesAtom),
    edges: store.get(edgesAtom),
  }),
  loadConfig: (cfg: Record<string, unknown>) =>
    store.set(
      nodesAtom,
      store
        .get(nodesAtom)
        .map((n) =>
          n.id === "action" ? { ...n, data: { ...n.data, config: cfg } } : n
        )
    ),
};
if (mode === "visual") {
  store.set(nodesAtom, [
    {
      id: "visual-trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        type: "trigger",
        label: "Manual",
        config: { triggerType: "Manual" },
      },
    },
    {
      id: "action",
      type: "action",
      position: { x: 250, y: 0 },
      data: {
        type: "action",
        label: "Guardar QA",
        config: {
          actionType: "Datos",
          operation: "save",
          collection: "qa_local",
          key: "SKU_DEMO",
          value: '{"stock":5}',
        },
      },
    },
  ]);
  store.set(edgesAtom, [
    {
      id: "visual-edge",
      source: "visual-trigger",
      target: "action",
      type: "animated",
    },
  ]);
  store.set(rightPanelWidthAtom, "384px");
}
let panel = (
  <div className="h-screen w-full bg-background text-foreground">
    <PanelInner />
  </div>
);
if (mode === "home") {
  panel = <Home />;
}
if (mode === "visual") {
  panel = (
    <div className="h-screen w-full bg-background text-foreground">
      <WorkflowCanvas />
      <aside className="absolute top-0 right-0 h-screen w-96 border-l bg-background">
        <PanelInner />
      </aside>
    </div>
  );
}
const content = (
  <Provider store={store}>
    <ReactFlowProvider>
      <OverlayProvider>{panel}</OverlayProvider>
    </ReactFlowProvider>
  </Provider>
);
const root = document.getElementById("root");
if (!root) {
  throw new Error("Fixture root missing");
}
createRoot(root).render(
  new URLSearchParams(location.search).has("strict") ? (
    <React.StrictMode>{content}</React.StrictMode>
  ) : (
    content
  )
);
