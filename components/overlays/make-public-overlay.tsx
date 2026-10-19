"use client";

import { Globe } from "lucide-react";
import { Overlay } from "./overlay";
import { useOverlay } from "./overlay-provider";
import type { OverlayComponentProps } from "./types";

type MakePublicOverlayProps = OverlayComponentProps<{
  onConfirm: () => void;
}>;

export function MakePublicOverlay({
  overlayId,
  onConfirm,
}: MakePublicOverlayProps) {
  const { closeAll } = useOverlay();

  const handleConfirm = () => {
    closeAll();
    onConfirm();
  };

  return (
    <Overlay
      actions={[
        { label: "Cancelar", variant: "outline", onClick: closeAll },
        { label: "Hacer público", onClick: handleConfirm },
      ]}
      overlayId={overlayId}
      title="¿Hacer público este workflow?"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Globe className="size-5 shrink-0" />
        <p className="text-sm">
          Making this workflow public means anyone with the link can:
        </p>
      </div>

      <ul className="mt-3 list-inside list-disc space-y-1 text-muted-foreground text-sm">
        <li>Ver la estructura y los pasos del workflow</li>
        <li>Ver los tipos de acción y su configuración</li>
        <li>Duplicar el workflow en su propia cuenta</li>
      </ul>

      <p className="mt-4 font-medium text-foreground text-sm">
        The following will remain private:
      </p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
        <li>Tus credenciales de integraciones (API keys, tokens)</li>
        <li>Los logs y el historial de ejecuciones</li>
      </ul>
    </Overlay>
  );
}
