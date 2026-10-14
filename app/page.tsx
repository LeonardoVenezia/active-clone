"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { authClient, useSession } from "@/lib/auth-client";
import {
  currentWorkflowNameAtom,
  edgesAtom,
  hasSidebarBeenShownAtom,
  isTransitioningFromHomepageAtom,
  nodesAtom,
} from "@/lib/workflow-store";
import { LAST_WORKFLOW_KEY } from "@/lib/last-workflow";

// Helper function to create a default trigger node
function createDefaultTriggerNode() {
  return {
    id: nanoid(),
    type: "trigger" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "",
      description: "",
      type: "trigger" as const,
      config: { triggerType: "Manual", placeholder: true },
      status: "idle" as const,
    },
  };
}

const Home = () => {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const nodes = useAtomValue(nodesAtom);
  const edges = useAtomValue(edgesAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setCurrentWorkflowName = useSetAtom(currentWorkflowNameAtom);
  const setHasSidebarBeenShown = useSetAtom(hasSidebarBeenShownAtom);
  const setIsTransitioningFromHomepage = useSetAtom(
    isTransitioningFromHomepageAtom
  );
  const hasCreatedWorkflowRef = useRef(false);
  const currentWorkflowName = useAtomValue(currentWorkflowNameAtom);

  // Reset sidebar animation state when on homepage
  useEffect(() => {
    setHasSidebarBeenShown(false);
  }, [setHasSidebarBeenShown]);

  // Update page title when workflow name changes
  useEffect(() => {
    document.title = `${currentWorkflowName} - Active-clone`;
  }, [currentWorkflowName]);

  // Helper to create anonymous session if needed
  const ensureSession = useCallback(async () => {
    if (!session) {
      await authClient.signIn.anonymous();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, [session]);

  // Initialize with a ready trigger node so no click is needed to start.
  useEffect(() => {
    setNodes([createDefaultTriggerNode()]);
    setEdges([]);
    setCurrentWorkflowName("New Workflow");
    hasCreatedWorkflowRef.current = false;
  }, [setNodes, setEdges, setCurrentWorkflowName]);

  // Create workflow when first real node is added
  useEffect(() => {
    const createWorkflowAndRedirect = async () => {
      // Wait for the session to load so we never replace a real login
      // with an anonymous one.
      if (isPending) {
        return;
      }
      // Filter out the placeholder "add" node
      const realNodes = nodes.filter((node) => node.type !== "add");

      // Only create when we have at least one real node and haven't created a workflow yet
      if (realNodes.length === 0 || hasCreatedWorkflowRef.current) {
        return;
      }
      hasCreatedWorkflowRef.current = true;

      try {
        await ensureSession();

        // Returning users go to the last workflow they visited; only users
        // with no workflows get a fresh blank one.
        try {
          if (new URLSearchParams(window.location.search).get("new") === "1") throw new Error("force-new");
          const existing = (await api.workflow.getAll()).filter(
            (w: { name: string }) => w.name !== "__current__"
          );
          if (existing.length > 0) {
            let target: { id: string } | undefined;
            try {
              const lastId = localStorage.getItem(LAST_WORKFLOW_KEY);
              target = existing.find((w: { id: string }) => w.id === lastId);
            } catch {
              /* ignore */
            }
            if (!target) {
              target = [...existing].sort(
                (a: { updatedAt?: string }, b: { updatedAt?: string }) =>
                  new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
              )[0];
            }
            sessionStorage.setItem("animate-sidebar", "true");
            setIsTransitioningFromHomepage(true);
            router.replace(`/workflows/${target.id}`);
            return;
          }
        } catch {
          // fall through and create a new workflow
        }

        // Create workflow with all real nodes
        const newWorkflow = await api.workflow.create({
          name: "Untitled Workflow",
          description: "",
          nodes: realNodes,
          edges,
        });

        // Set flags to indicate we're coming from homepage (for sidebar animation)
        sessionStorage.setItem("animate-sidebar", "true");
        setIsTransitioningFromHomepage(true);

        // Redirect to the workflow page
        console.log("[Homepage] Navigating to workflow page");
        router.replace(`/workflows/${newWorkflow.id}`);
      } catch (error) {
        console.error("Failed to create workflow:", error);
        toast.error("Failed to create workflow");
      }
    };

    createWorkflowAndRedirect();
  }, [nodes, edges, router, ensureSession, setIsTransitioningFromHomepage, isPending]);

  // Canvas and toolbar are rendered by PersistentCanvas in the layout
  return null;
};

export default Home;
