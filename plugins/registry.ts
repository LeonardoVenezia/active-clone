import type { IntegrationType } from "@/lib/types/integration";
import { LEGACY_ACTION_MAPPINGS } from "./legacy-mappings";

/**
 * Select Option
 * Used for select/dropdown fields
 */
export type SelectOption = {
  value: string;
  label: string;
};

/**
 * Base Action Config Field
 * Declarative definition of a config field for an action
 */
export type ActionConfigFieldBase = {
  // Unique key for this field in the config object
  key: string;

  // Human-readable label
  label: string;

  // Field type
  type:
    | "template-input" // TemplateBadgeInput - supports {{variable}}
    | "template-textarea" // TemplateBadgeTextarea - supports {{variable}}
    | "text" // Regular text input
    | "number" // Number input
    | "select" // Dropdown select
    | "schema-builder" // Schema builder for structured output
    | "composio-args"; // Per-parameter form for composio/run-tool, from the Composio tool schema (reads sibling toolkit + tool config)

  // Placeholder text
  placeholder?: string;

  // Default value
  defaultValue?: string;

  // Example value for AI prompt generation
  example?: string;

  // For select fields: list of options
  options?: SelectOption[];

  // Number of rows (for textarea)
  rows?: number;

  // Min value (for number fields)
  min?: number;

  // Whether this field is required (defaults to false)
  required?: boolean;

  // Conditional rendering: only show if another field has a specific value
  showWhen?: {
    field: string;
    equals: string;
  };
};

/**
 * Config Field Group
 * Groups related fields together in a collapsible section
 */
export type ActionConfigFieldGroup = {
  // Human-readable label for the group
  label: string;

  // Field type (always "group" for groups)
  type: "group";

  // Nested fields within this group
  fields: ActionConfigFieldBase[];

  // Whether the group is expanded by default (defaults to false)
  defaultExpanded?: boolean;
};

/**
 * Action Config Field
 * Can be either a regular field or a group of fields
 */
export type ActionConfigField = ActionConfigFieldBase | ActionConfigFieldGroup;

/**
 * Output Field Definition
 * Describes an output field available for template autocomplete
 */
export type OutputField = {
  field: string;
  description: string;
};

/**
 * Result Component Props
 * Props passed to custom result components
 */
export type ResultComponentProps = {
  output: unknown;
  input?: unknown;
};

/**
 * Output Display Config
 * Specifies how to render step output in the workflow runs panel
 */
export type OutputDisplayConfig =
  | {
      // Built-in display types
  type: "image" | "video" | "url";
  // Field name in the step output that contains the displayable value
  field: string;
    }
  | {
      // Custom component display
      type: "component";
      // React component to render the output
      component: React.ComponentType<ResultComponentProps>;
};

/**
 * Action Definition
 * Describes a single action provided by a plugin
 */
export type PluginAction = {
  // Unique slug for this action (e.g., "send-email")
  // Full action ID will be computed as `{integration}/{slug}` (e.g., "resend/send-email")
  slug: string;

  // Human-readable label (e.g., "Send Email")
  label: string;

  // Description of what this action does
  description: string;

  // Category for grouping in UI
  category: string;

  // Step configuration
  stepFunction: string; // Name of the exported function in the step file
  stepImportPath: string; // Path to import from, relative to plugins/[plugin-name]/steps/

  // Config fields for the action (declarative definition)
  configFields: ActionConfigField[];

  // Output fields for template autocomplete (what this action returns)
  outputFields?: OutputField[];

  // Output display configuration (how to render output in workflow runs panel)
  outputConfig?: OutputDisplayConfig;

  // Code generation template (the actual template string, not a path)
  // Optional - if not provided, will fall back to auto-generated template
  // from steps that export _exportCore
  codegenTemplate?: string;
};

/**
 * Trigger Definition
 * Describes an event an integration can emit (e.g. "payment updated").
 * Triggers are fed by the integration's incoming webhook (see `webhook`).
 */
export type PluginTrigger = {
  // Unique slug within the plugin. Full trigger ID: `{integration}/{slug}`
  slug: string;
  label: string;
  description: string;
  category: string;
  // Optional filters configured on the trigger node
  configFields: ActionConfigField[];
  // Fields available to later nodes as {{Trigger.field}}
  outputFields?: OutputField[];
};

/**
 * Normalized event produced by a plugin's webhook handler.
 */
export type IntegrationWebhookEvent = {
  // Stable id from the provider, used to drop retried deliveries
  externalId: string;
  // Slug of the PluginTrigger this event belongs to
  trigger: string;
  // Event payload exposed to workflows
  data: Record<string, unknown>;
};

export type IntegrationWebhookRequest = {
  headers: Headers;
  // Exact body text as received (needed for signature checks)
  rawBody: string;
  query: URLSearchParams;
};

/**
 * Server-side webhook handler for an integration.
 * Lazy-loaded so it never reaches the client bundle.
 */
export type IntegrationWebhookHandler = {
  // Return null when the request is authentic, or a short reason when not.
  verify: (
    request: IntegrationWebhookRequest,
    credentials: Record<string, string | undefined>
  ) => string | null;
  // Turn the provider payload into zero or more normalized events.
  parse: (
    request: IntegrationWebhookRequest,
    credentials: Record<string, string | undefined>
  ) => IntegrationWebhookEvent[];
  // Optional GET handshake (Meta/WhatsApp style challenge). Return the
  // response to send, or null when the query is not a handshake.
  handshake?: (
    query: URLSearchParams,
    credentials: Record<string, string | undefined>
  ) => { status: number; body: string } | null;
};

/**
 * Integration Plugin Definition
 * All information needed to register a new integration in one place
 */
export type IntegrationPlugin = {
  // Basic info
  type: IntegrationType;
  label: string;
  description: string;

  // Icon component (should be exported from plugins/[name]/icon.tsx)
  icon: React.ComponentType<{ className?: string }>;

  // Form fields for the integration dialog
  formFields: Array<{
    id: string;
    label: string;
    type: "text" | "password" | "url";
    placeholder?: string;
    helpText?: string;
    helpLink?: { text: string; url: string };
    configKey: string; // Which key in IntegrationConfig to store the value
    envVar?: string; // Environment variable this field maps to (e.g., "RESEND_API_KEY")
  }>;

  // Testing configuration (lazy-loaded to avoid bundling Node.js packages in client)
  testConfig?: {
    // Returns a promise that resolves to the test function
    // This allows the test module to be loaded only on the server when needed
    getTestFunction: () => Promise<
      (
        credentials: Record<string, string>
      ) => Promise<{ success: boolean; error?: string }>
    >;
  };

  // Avoid using this field. Plugins should use fetch instead of SDK dependencies
  // to reduce supply chain attack surface. Only use for codegen if absolutely necessary.
  dependencies?: Record<string, string>;

  // Actions provided by this integration
  actions: PluginAction[];

  // Events this integration can emit (optional)
  triggers?: PluginTrigger[];

  // Incoming webhook support (optional). Events are received at
  // /api/integrations/webhooks/{type}/{integrationId}
  webhook?: {
    getHandler: () => Promise<IntegrationWebhookHandler>;
  };
};

/**
 * Action with full ID
 * Includes the computed full action ID (integration/slug)
 */
export type ActionWithFullId = PluginAction & {
  id: string; // Full action ID: {integration}/{slug}
  integration: IntegrationType;
};

/**
 * Integration Registry
 * Auto-populated by plugin files
 */
const integrationRegistry = new Map<IntegrationType, IntegrationPlugin>();

/**
 * Compute full action ID from integration type and action slug
 */
export function computeActionId(
  integrationType: IntegrationType,
  actionSlug: string
): string {
  return `${integrationType}/${actionSlug}`;
}

/**
 * Parse a full action ID into integration type and action slug
 */
export function parseActionId(actionId: string | undefined | null): {
  integration: string;
  slug: string;
} | null {
  if (!actionId || typeof actionId !== "string") {
    return null;
  }
  const parts = actionId.split("/");
  if (parts.length !== 2) {
    return null;
  }
  return { integration: parts[0], slug: parts[1] };
}

/**
 * Register an integration plugin
 */
export function registerIntegration(plugin: IntegrationPlugin) {
  integrationRegistry.set(plugin.type, plugin);
}

/**
 * Get an integration plugin
 */
export function getIntegration(
  type: IntegrationType
): IntegrationPlugin | undefined {
  return integrationRegistry.get(type);
}

/**
 * Get all registered integrations
 */
export function getAllIntegrations(): IntegrationPlugin[] {
  return Array.from(integrationRegistry.values());
}

/**
 * Get all integration types
 */
export function getIntegrationTypes(): IntegrationType[] {
  return Array.from(integrationRegistry.keys());
}

/**
 * Get all actions across all integrations with full IDs
 */
export function getAllActions(): ActionWithFullId[] {
  const actions: ActionWithFullId[] = [];

  for (const plugin of integrationRegistry.values()) {
    for (const action of plugin.actions) {
      actions.push({
        ...action,
        id: computeActionId(plugin.type, action.slug),
        integration: plugin.type,
      });
    }
  }

  return actions;
}

/**
 * Get actions by category
 */
export function getActionsByCategory(): Record<string, ActionWithFullId[]> {
  const categories: Record<string, ActionWithFullId[]> = {};

  for (const plugin of integrationRegistry.values()) {
    for (const action of plugin.actions) {
      if (!categories[action.category]) {
        categories[action.category] = [];
      }
      categories[action.category].push({
        ...action,
        id: computeActionId(plugin.type, action.slug),
        integration: plugin.type,
      });
    }
  }

  return categories;
}

/**
 * Find an action by full ID (e.g., "resend/send-email")
 * Also supports legacy IDs (e.g., "Send Email") for backward compatibility
 */
export function findActionById(
  actionId: string | undefined | null
): ActionWithFullId | undefined {
  if (!actionId) {
    return undefined;
  }

  // First try parsing as a namespaced ID
  const parsed = parseActionId(actionId);
  if (parsed) {
    const plugin = integrationRegistry.get(parsed.integration as IntegrationType);
    if (plugin) {
      const action = plugin.actions.find((a) => a.slug === parsed.slug);
      if (action) {
        return {
          ...action,
          id: actionId,
          integration: plugin.type,
        };
      }
    }
  }

  // Check legacy mappings for backward compatibility
  const mappedId = LEGACY_ACTION_MAPPINGS[actionId];
  if (mappedId) {
    // Recursively look up the mapped ID
    return findActionById(mappedId);
  }

  // Fall back to legacy label-based lookup (exact label match)
  for (const plugin of integrationRegistry.values()) {
    const action = plugin.actions.find((a) => a.label === actionId);
    if (action) {
      return {
        ...action,
        id: computeActionId(plugin.type, action.slug),
        integration: plugin.type,
      };
    }
  }

  return undefined;
}

/**
 * Get integration labels map
 */
export function getIntegrationLabels(): Record<IntegrationType, string> {
  const labels: Record<string, string> = {};
  for (const plugin of integrationRegistry.values()) {
    labels[plugin.type] = plugin.label;
  }
  return labels as Record<IntegrationType, string>;
}

/**
 * Get integration descriptions map
 */
export function getIntegrationDescriptions(): Record<IntegrationType, string> {
  const descriptions: Record<string, string> = {};
  for (const plugin of integrationRegistry.values()) {
    descriptions[plugin.type] = plugin.description;
  }
  return descriptions as Record<IntegrationType, string>;
}

/**
 * Get sorted integration types for dropdowns
 */
export function getSortedIntegrationTypes(): IntegrationType[] {
  return Array.from(integrationRegistry.keys()).sort();
}

/**
 * Get all NPM dependencies across all integrations
 */
export function getAllDependencies(): Record<string, string> {
  const deps: Record<string, string> = {};

  for (const plugin of integrationRegistry.values()) {
    if (plugin.dependencies) {
      Object.assign(deps, plugin.dependencies);
    }
  }

  return deps;
}

/**
 * Get NPM dependencies for specific action IDs
 */
export function getDependenciesForActions(
  actionIds: string[]
): Record<string, string> {
  const deps: Record<string, string> = {};
  const integrations = new Set<IntegrationType>();

  // Find which integrations are used
  for (const actionId of actionIds) {
    const action = findActionById(actionId);
    if (action) {
      integrations.add(action.integration);
    }
  }

  // Get dependencies for those integrations
  for (const integrationType of integrations) {
    const plugin = integrationRegistry.get(integrationType);
    if (plugin?.dependencies) {
      Object.assign(deps, plugin.dependencies);
    }
  }

  return deps;
}

/**
 * Get environment variables for a single plugin (from formFields)
 */
export function getPluginEnvVars(
  plugin: IntegrationPlugin
): Array<{ name: string; description: string }> {
  const envVars: Array<{ name: string; description: string }> = [];

  // Get env vars from form fields
  for (const field of plugin.formFields) {
    if (field.envVar) {
      envVars.push({
        name: field.envVar,
        description: field.helpText || field.label,
      });
    }
  }

  return envVars;
}

/**
 * Get all environment variables across all integrations
 */
export function getAllEnvVars(): Array<{ name: string; description: string }> {
  const envVars: Array<{ name: string; description: string }> = [];

  for (const plugin of integrationRegistry.values()) {
    envVars.push(...getPluginEnvVars(plugin));
  }

  return envVars;
}

/**
 * Get credential mapping for a plugin (auto-generated from formFields)
 */
export function getCredentialMapping(
  plugin: IntegrationPlugin,
  config: Record<string, unknown>
): Record<string, string> {
  const creds: Record<string, string> = {};

  for (const field of plugin.formFields) {
    if (field.envVar && config[field.configKey]) {
      creds[field.envVar] = String(config[field.configKey]);
    }
  }

  return creds;
}

/**
 * Type guard to check if a field is a group
 */
export function isFieldGroup(
  field: ActionConfigField
): field is ActionConfigFieldGroup {
  return field.type === "group";
}

/**
 * Flatten config fields, extracting fields from groups
 * Useful for validation and AI prompt generation
 */
export function flattenConfigFields(
  fields: ActionConfigField[]
): ActionConfigFieldBase[] {
  const result: ActionConfigFieldBase[] = [];

  for (const field of fields) {
    if (isFieldGroup(field)) {
      result.push(...field.fields);
    } else {
      result.push(field);
    }
  }

  return result;
}

/**
 * Generate AI prompt section for all available actions
 * This dynamically builds the action types documentation for the AI
 */
export function generateAIActionPrompts(): string {
  const lines: string[] = [];

  for (const plugin of integrationRegistry.values()) {
    for (const action of plugin.actions) {
      const fullId = computeActionId(plugin.type, action.slug);

      // Build example config from configFields (flatten groups)
      const exampleConfig: Record<string, string | number> = {
        actionType: fullId,
      };

      const flatFields = flattenConfigFields(action.configFields);

      for (const field of flatFields) {
        // Skip conditional fields in the example
        if (field.showWhen) continue;

        // Use example, defaultValue, or a sensible default based on type
        if (field.example !== undefined) {
          exampleConfig[field.key] = field.example;
        } else if (field.defaultValue !== undefined) {
          exampleConfig[field.key] = field.defaultValue;
        } else if (field.type === "number") {
          exampleConfig[field.key] = 10;
        } else if (field.type === "select" && field.options?.[0]) {
          exampleConfig[field.key] = field.options[0].value;
        } else {
          // Angle-bracket placeholders are caught by the validator if the model copies them verbatim.
          exampleConfig[field.key] = `<${field.key}>`;
        }
      }

      const outputsNote = action.outputFields?.length
        ? ` | outputs: ${action.outputFields.map((f) => f.field).join(", ")}`
        : "";
      lines.push(
        `- ${action.label} (${fullId}): ${JSON.stringify(exampleConfig)}${outputsNote}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * All plugin triggers with their full id ({integration}/{slug}) and label.
 */
export function getAllTriggers(): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  for (const plugin of integrationRegistry.values()) {
    for (const trigger of plugin.triggers ?? []) {
      result.push({ id: computeActionId(plugin.type, trigger.slug), label: trigger.label });
    }
  }
  return result;
}

/**
 * AI prompt section listing plugin triggers (event sources) with config examples
 * and output fields, so the model can start flows from real app events.
 */
export function generateAITriggerPrompts(): string {
  const lines: string[] = [];
  for (const plugin of integrationRegistry.values()) {
    for (const trigger of plugin.triggers ?? []) {
      const fullId = computeActionId(plugin.type, trigger.slug);
      const exampleConfig: Record<string, string | number> = { triggerType: fullId };
      for (const field of flattenConfigFields(trigger.configFields ?? [])) {
        if (field.showWhen) continue;
        if (field.example !== undefined) exampleConfig[field.key] = field.example;
        else if (field.defaultValue !== undefined) exampleConfig[field.key] = field.defaultValue;
        else if (field.type === "number") exampleConfig[field.key] = 10;
        else if (field.type === "select" && field.options?.[0]) exampleConfig[field.key] = field.options[0].value;
        else exampleConfig[field.key] = `<${field.key}>`;
      }
      const outputsNote = trigger.outputFields?.length
        ? ` | outputs: ${trigger.outputFields.map((f) => f.field).join(", ")}`
        : "";
      lines.push(
        `- ${trigger.label} (${fullId}): ${JSON.stringify(exampleConfig)}${outputsNote}`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Map of full action id -> declared output field names.
 * Used by deterministic flow validation (lib/flow-validator.ts).
 */
export function getActionOutputFields(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const plugin of integrationRegistry.values()) {
    for (const action of plugin.actions) {
      if (action.outputFields?.length) {
        map[computeActionId(plugin.type, action.slug)] = action.outputFields.map(
          (f) => f.field
        );
      }
    }
  }
  return map;
}

/**
 * Item fields of array outputs, parsed from output descriptions that list
 * them in parentheses, e.g. "List of orders (id, number, total)".
 * Used by the flow validator to check {{@item:Item.field}} references
 * inside Loops against the real shape of the source action's items.
 */
export function getActionOutputItemFields(): Record<
  string,
  Record<string, string[]>
> {
  const map: Record<string, Record<string, string[]>> = {};
  for (const plugin of integrationRegistry.values()) {
    for (const action of plugin.actions) {
      if (!action.outputFields?.length) continue;
      const actionId = computeActionId(plugin.type, action.slug);
      for (const f of action.outputFields) {
        const match = /\(([^)]+)\)/.exec(f.description ?? "");
        if (!match) continue;
        // Nested sub-shapes are listed after a colon ("variants: id, sku, ...");
        // they belong to a nested array, not to the top-level item, so the
        // field list ends at the first token that opens a nested spec.
        const tokens = match[1].split(",").map((x) => x.trim());
        const cut = tokens.findIndex((x) => x.includes(":"));
        const fields = (cut === -1 ? tokens : tokens.slice(0, cut))
          .filter((x) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(x));
        if (fields.length === 0) continue;
        if (!map[actionId]) map[actionId] = {};
        (map[actionId] as Record<string, string[]>)[f.field] = fields;
      }
    }
  }
  return map;
}
