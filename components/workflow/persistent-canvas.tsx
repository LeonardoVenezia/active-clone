"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { WorkflowCanvas } from "./workflow-canvas";

export function PersistentCanvas() {
  const pathname = usePathname();

  // Show canvas on homepage and workflow pages
  const showCanvas = pathname === "/" || (pathname.startsWith("/workflows/") && !pathname.startsWith("/workflows/mail/"));

  if (!showCanvas) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-0 flex flex-col bg-background">
      <AppHeader fluid />
      <div className="min-h-0 flex-1">
        <WorkflowCanvas />
      </div>
    </div>
  );
}
