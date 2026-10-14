import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Handle, Position, useNodeId } from "@xyflow/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { nanoid } from "nanoid";
import {
  addNodeAtom,
  autosaveAtom,
  edgesAtom,
  hasUnsavedChangesAtom,
  nodesAtom,
  propertiesPanelActiveTabAtom,
  selectedNodeAtom,
  type WorkflowNode,
} from "@/lib/workflow-store";
import type { ComponentProps, MouseEvent as ReactMouseEvent } from "react";
import { AnimatedBorder } from "@/components/ui/animated-border";

export type NodeProps = ComponentProps<typeof Card> & {
  handles: {
    target: boolean;
    source: boolean;
  };
  status?: "idle" | "running" | "success" | "error";
};

export const Node = ({ handles, className, status, ...props }: NodeProps) => {
  const nodeId = useNodeId();
  const nodes = useAtomValue(nodesAtom);
  const [edges, setEdges] = useAtom(edgesAtom);
  const addNode = useSetAtom(addNodeAtom);
  const setSelectedNode = useSetAtom(selectedNodeAtom);
  const setActiveTab = useSetAtom(propertiesPanelActiveTabAtom);
  const setHasUnsavedChanges = useSetAtom(hasUnsavedChangesAtom);
  const triggerAutosave = useSetAtom(autosaveAtom);

  const addStepAfter = (event: ReactMouseEvent) => {
    event.stopPropagation();
    const source = nodes.find((n) => n.id === nodeId);
    if (!source) {
      return;
    }
    const position = { x: source.position.x + 300, y: source.position.y };
    while (
      nodes.some(
        (n) =>
          Math.abs(n.position.x - position.x) < 40 &&
          Math.abs(n.position.y - position.y) < 40
      )
    ) {
      position.y += 220;
    }
    const newNode: WorkflowNode = {
      id: nanoid(),
      type: "action",
      position,
      data: {
        label: "",
        description: "",
        type: "action",
        config: {},
        status: "idle",
      },
    };
    addNode(newNode);
    setEdges([
      ...edges,
      { id: nanoid(), source: source.id, target: newNode.id, type: "animated" },
    ]);
    setSelectedNode(newNode.id);
    setActiveTab("properties");
    setHasUnsavedChanges(true);
    triggerAutosave({ immediate: true });
  };

  return (
  <Card
    className={cn(
      "node-container relative size-full h-auto w-sm gap-0 rounded-md bg-card p-0 transition-all duration-200",
      status === "success" && "border-green-500 border-2",
      status === "error" && "border-red-500 border-2",
      className
    )}
    {...props}
  >
    {status === "running" && <AnimatedBorder />}
    {handles.target && <Handle position={Position.Left} type="target" />}
    {handles.source && (
      <Handle
        className="!size-6 !border-2 !border-primary !bg-primary !text-primary-foreground flex cursor-pointer items-center justify-center text-sm font-bold leading-none"
        onClick={addStepAfter}
        position={Position.Right}
        title="Agregar un paso (clic o arrastrá)"
        type="source"
      >
        +
      </Handle>
    )}
    {props.children}
  </Card>
  );
};

export type NodeHeaderProps = ComponentProps<typeof CardHeader>;

export const NodeHeader = ({ className, ...props }: NodeHeaderProps) => (
  <CardHeader
    className={cn("gap-0.5 rounded-t-md border-b bg-secondary p-3!", className)}
    {...props}
  />
);

export type NodeTitleProps = ComponentProps<typeof CardTitle>;

export const NodeTitle = (props: NodeTitleProps) => <CardTitle {...props} />;

export type NodeDescriptionProps = ComponentProps<typeof CardDescription>;

export const NodeDescription = (props: NodeDescriptionProps) => (
  <CardDescription {...props} />
);

export type NodeActionProps = ComponentProps<typeof CardAction>;

export const NodeAction = (props: NodeActionProps) => <CardAction {...props} />;

export type NodeContentProps = ComponentProps<typeof CardContent>;

export const NodeContent = ({ className, ...props }: NodeContentProps) => (
  <CardContent className={cn("rounded-b-md bg-card p-3", className)} {...props} />
);

export type NodeFooterProps = ComponentProps<typeof CardFooter>;

export const NodeFooter = ({ className, ...props }: NodeFooterProps) => (
  <CardFooter
    className={cn("rounded-b-md border-t bg-secondary p-3!", className)}
    {...props}
  />
);
