import type { ReactFlowInstance } from "@xyflow/react";

// Space covered by overlays on top of the canvas. Computed from the FINAL
// layout (not from animated positions) so every centering call agrees.
export function getCanvasInsets(): { left: number; right: number } {
  if (typeof window === "undefined") return { left: 0, right: 0 };
  // Chat and properties panel only exist on the workflow editor route.
  if (!window.location.pathname.startsWith("/workflows/")) {
    return { left: 0, right: 0 };
  }
  const w = window.innerWidth;
  let chatOpen = true;
  try {
    chatOpen = localStorage.getItem("chat-open") !== "0";
  } catch {
    /* ignore */
  }
  const left = chatOpen && w >= 640 ? Math.min(352, w * 0.85) : 0;
  const cookies = document.cookie.split("; ");
  const collapsed = cookies.includes("sidebar-collapsed=true");
  const widthCookie = cookies.find((r) => r.startsWith("sidebar-width="));
  let pct = 30;
  if (widthCookie) {
    const v = Number.parseFloat(widthCookie.split("=")[1]);
    if (!Number.isNaN(v) && v >= 20 && v <= 50) pct = v;
  }
  const right = !collapsed && w >= 768 ? (w * pct) / 100 : 0;
  return { left, right };
}

// Center a point (flow coords) in the visible canvas area.
export function centerInVisibleArea(
  rf: Pick<ReactFlowInstance, "setViewport">,
  cx: number,
  cy: number,
  zoom: number,
  duration = 0
) {
  const { left, right } = getCanvasInsets();
  const screenX = left + (window.innerWidth - left - right) / 2;
  const screenY = window.innerHeight / 2;
  rf.setViewport(
    { x: screenX - cx * zoom, y: screenY - cy * zoom, zoom },
    { duration }
  );
}

// Fit all nodes inside the visible canvas area.
export function fitInVisibleArea(
  rf: Pick<ReactFlowInstance, "setViewport" | "getNodes" | "getNodesBounds">,
  opts: { maxZoom?: number; minZoom?: number; padding?: number; duration?: number } = {}
) {
  const { maxZoom = 1, minZoom = 0.2, padding = 0.2, duration = 0 } = opts;
  const nodes = rf.getNodes();
  if (nodes.length === 0) return;
  // Unmeasured nodes (first paint) default to the real card size so the
  // first and later calls agree.
  const b = rf.getNodesBounds(
    nodes.map((n) => ({
      ...n,
      width: n.measured?.width ?? n.width ?? 384,
      height: n.measured?.height ?? n.height ?? 384,
    }))
  );
  const { left, right } = getCanvasInsets();
  const vw = Math.max(200, window.innerWidth - left - right);
  const vh = window.innerHeight;
  const zoom = Math.min(
    maxZoom,
    Math.max(
      minZoom,
      Math.min(vw / (b.width * (1 + padding * 2) || 1), vh / (b.height * (1 + padding * 2) || 1))
    )
  );
  centerInVisibleArea(rf, b.x + b.width / 2, b.y + b.height / 2, zoom, duration);
}

// Wait until nodes exist and are measured, then fit once. Returns a cancel fn.
export function fitWhenReady(
  rf: Pick<ReactFlowInstance, "setViewport" | "getNodes" | "getNodesBounds">,
  opts: Parameters<typeof fitInVisibleArea>[1],
  done?: () => void,
  maxWaitMs = 4000
) {
  const start = Date.now();
  const timer = setInterval(() => {
    const nodes = rf.getNodes();
    const measured = nodes.length > 0 && nodes.every((n) => n.measured?.width);
    if (measured || Date.now() - start > maxWaitMs) {
      clearInterval(timer);
      fitInVisibleArea(rf, opts);
      done?.();
    }
  }, 50);
  return () => clearInterval(timer);
}
