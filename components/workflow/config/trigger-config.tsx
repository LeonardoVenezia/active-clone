"use client";

import { Clock, Copy, Play, Webhook, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Input } from "@/components/ui/input";
import { IntegrationSelector } from "@/components/ui/integration-selector";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import type { IntegrationType } from "@/lib/types/integration";
import { getAllIntegrations } from "@/plugins";
import { SchemaBuilder, type SchemaField } from "./schema-builder";

type IntegrationTriggerOption = {
  id: string; // "{type}/{slug}"
  type: IntegrationType;
  label: string;
  description: string;
};

function getIntegrationTriggerOptions(): IntegrationTriggerOption[] {
  return getAllIntegrations().flatMap((plugin) =>
    (plugin.triggers ?? []).map((trigger) => ({
      id: `${plugin.type}/${trigger.slug}`,
      type: plugin.type,
      label: `${plugin.label}: ${trigger.label}`,
      description: trigger.description,
    }))
  );
}

/**
 * Turns a workflow on or off for integration events.
 * Off by default; only workflows that are on are started by events.
 */
function ActiveToggle({
  workflowId,
  disabled,
}: {
  workflowId?: string;
  disabled: boolean;
}) {
  const [active, setActive] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workflowId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/workflows/${workflowId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((workflow) => {
        if (!cancelled && workflow) {
          setActive(Boolean(workflow.active));
        }
      })
      .catch(() => {
        // Leave the toggle unknown; the user can retry by reopening the panel.
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const toggle = useCallback(async () => {
    if (!workflowId || active === null) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(body.error || "No se pudo cambiar el estado");
        return;
      }
      setActive(Boolean(body.active));
      toast.success(body.active ? "Workflow activado" : "Workflow pausado");
    } finally {
      setSaving(false);
    }
  }, [workflowId, active]);

  return (
    <div className="space-y-2">
      <Label className="ml-1">Estado</Label>
      <div className="flex items-center justify-between gap-2 rounded-md border p-3">
        <p className="text-xs">
          {active
            ? "Activo: se ejecuta solo cuando llega el evento."
            : "Pausado: no se ejecuta con eventos reales."}
        </p>
        <Button
          disabled={disabled || saving || active === null || !workflowId}
          onClick={toggle}
          size="sm"
          variant={active ? "outline" : "default"}
        >
          {active ? "Pausar" : "Activar"}
        </Button>
      </div>
    </div>
  );
}

type TriggerConfigProps = {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
  workflowId?: string;
};

export function TriggerConfig({
  config,
  onUpdateConfig,
  disabled,
  workflowId,
}: TriggerConfigProps) {
  const webhookUrl = workflowId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/workflows/${workflowId}/webhook`
    : "";

  const handleCopyWebhookUrl = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl);
      toast.success("Webhook URL copied to clipboard");
    }
  };

  const integrationTriggerOptions = useMemo(
    () => getIntegrationTriggerOptions(),
    []
  );
  const selectedIntegrationTrigger = integrationTriggerOptions.find(
    (option) => option.id === config?.integrationTrigger
  );
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // Mercado Libre has one notification URL per app, shared by all sellers.
  const integrationWebhookUrl =
    selectedIntegrationTrigger && config?.integrationId
      ? selectedIntegrationTrigger.type === "mercadolibre"
        ? `${origin}/api/integrations/mercadolibre/notifications`
        : `${origin}/api/integrations/webhooks/${selectedIntegrationTrigger.type}/${config.integrationId as string}`
      : "";

  return (
    <>
      <div className="space-y-2">
        <Label className="ml-1" htmlFor="triggerType">
          Trigger Type
        </Label>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            onUpdateConfig("triggerType", value);
            if (config?.placeholder) {
              onUpdateConfig("placeholder", "");
            }
          }}
          value={
            config?.placeholder
              ? ""
              : (config?.triggerType as string) || "Manual"
          }
        >
          <SelectTrigger className="w-full" id="triggerType">
            <SelectValue placeholder="Select trigger type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Manual">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4" />
                Manual
              </div>
            </SelectItem>
            <SelectItem value="Schedule">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Schedule
              </div>
            </SelectItem>
            <SelectItem value="Webhook">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4" />
                Webhook
              </div>
            </SelectItem>
            {integrationTriggerOptions.length > 0 && (
              <SelectItem value="Integration">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Integration event
                </div>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Integration event fields */}
      {config?.triggerType === "Integration" && (
        <>
          <div className="space-y-2">
            <Label className="ml-1" htmlFor="integrationTrigger">
              Event
            </Label>
            <Select
              disabled={disabled}
              onValueChange={(value) => {
                onUpdateConfig("integrationTrigger", value);
                // The connection must match the new event's integration.
                onUpdateConfig("integrationId", "");
              }}
              value={(config?.integrationTrigger as string) || ""}
            >
              <SelectTrigger className="w-full" id="integrationTrigger">
                <SelectValue placeholder="Select an event" />
              </SelectTrigger>
              <SelectContent>
                {integrationTriggerOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedIntegrationTrigger && (
              <p className="text-muted-foreground text-xs">
                {selectedIntegrationTrigger.description}
              </p>
            )}
          </div>
          {selectedIntegrationTrigger && (
            <>
              <div className="space-y-2">
                <Label className="ml-1">Connection</Label>
                <IntegrationSelector
                  disabled={disabled}
                  integrationType={selectedIntegrationTrigger.type}
                  onChange={(id) => onUpdateConfig("integrationId", id)}
                  value={(config?.integrationId as string) || ""}
                />
              </div>
              <div className="space-y-2">
                <Label className="ml-1">Notification URL</Label>
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-xs"
                    disabled
                    value={
                      integrationWebhookUrl ||
                      "Select a connection to get the URL"
                    }
                  />
                  <Button
                    disabled={!integrationWebhookUrl}
                    onClick={() => {
                      navigator.clipboard.writeText(integrationWebhookUrl);
                      toast.success("URL copied to clipboard");
                    }}
                    size="icon"
                    variant="outline"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Paste this URL in the provider&apos;s notification settings.
                </p>
              </div>
              <ActiveToggle disabled={disabled} workflowId={workflowId} />
            </>
          )}
        </>
      )}

      {/* Webhook fields */}
      {config?.triggerType === "Webhook" && (
        <>
          <div className="space-y-2">
            <Label className="ml-1">Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                className="font-mono text-xs"
                disabled
                value={webhookUrl || "Save workflow to generate webhook URL"}
              />
              <Button
                disabled={!webhookUrl}
                onClick={handleCopyWebhookUrl}
                size="icon"
                variant="outline"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Request Schema (Optional)</Label>
            <SchemaBuilder
              disabled={disabled}
              onChange={(schema) =>
                onUpdateConfig("webhookSchema", JSON.stringify(schema))
              }
              schema={
                config?.webhookSchema
                  ? (JSON.parse(
                      config.webhookSchema as string
                    ) as SchemaField[])
                  : []
              }
            />
            <p className="text-muted-foreground text-xs">
              Define the expected structure of the incoming webhook payload.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookMockRequest">Mock Request (Optional)</Label>
            <div className="overflow-hidden rounded-md border">
              <CodeEditor
                defaultLanguage="json"
                height="150px"
                onChange={(value) =>
                  onUpdateConfig("webhookMockRequest", value || "")
                }
                options={{
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  readOnly: disabled,
                  wordWrap: "on",
                }}
                value={(config?.webhookMockRequest as string) || ""}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Enter a sample JSON payload to test the webhook trigger.
            </p>
          </div>
        </>
      )}

      {/* Schedule fields */}
      {config?.triggerType === "Schedule" && (
        <>
          <div className="space-y-2">
            <Label className="ml-1" htmlFor="scheduleCron">
              Cron Expression
            </Label>
            <Input
              disabled={disabled}
              id="scheduleCron"
              onChange={(e) => onUpdateConfig("scheduleCron", e.target.value)}
              placeholder="0 9 * * * (every day at 9am)"
              value={(config?.scheduleCron as string) || ""}
            />
          </div>
          <div className="space-y-2">
            <Label className="ml-1" htmlFor="scheduleTimezone">
              Timezone
            </Label>
            <TimezoneSelect
              disabled={disabled}
              id="scheduleTimezone"
              onValueChange={(value) =>
                onUpdateConfig("scheduleTimezone", value)
              }
              value={(config?.scheduleTimezone as string) || "America/New_York"}
            />
          </div>
        </>
      )}
    </>
  );
}
