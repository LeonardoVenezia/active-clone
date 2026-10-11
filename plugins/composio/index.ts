import { Blocks } from "lucide-react";
import { type IntegrationPlugin, registerIntegration } from "../registry";

const plugin: IntegrationPlugin = {
  type: "composio",
  label: "Composio",
  description: "Discover toolkits and read public Hacker News data. Project key is configured server-side. Connected apps run as the workflow owner.",
  icon: Blocks,
  formFields: [],
  actions: [
    {
      slug: "discover", label: "Discover Composio Tools", category: "Composio",
      description: "List available toolkits, inspect a toolkit's real action schemas, or inspect Hacker News actions. Does not execute tools.",
      stepFunction: "discoverComposioStep", stepImportPath: "catalog",
      configFields: [
        { key: "catalog", label: "Catalog", type: "select", defaultValue: "toolkits", options: [{ value: "toolkits", label: "Toolkits" }, { value: "hackernews", label: "Hacker News tools" }, { value: "tools", label: "Actions for one toolkit" }] },
        { key: "search", label: "Search", type: "template-input", placeholder: "hackernews" },
        { key: "toolkit", label: "Toolkit slug (for actions)", type: "template-input", placeholder: "outlook", showWhen: { field: "catalog", equals: "tools" } },
      ],
      outputFields: [{ field: "items", description: "Toolkit or tool metadata, without credentials" }, { field: "count", description: "Items on this page" }],
    },
    {
      slug: "read-hackernews", label: "Read Hacker News", category: "Composio",
      description: "Read public Hacker News only. Execution is disabled until the project owner verifies plan and billing limits.",
      stepFunction: "readHackerNewsStep", stepImportPath: "catalog",
      configFields: [
        { key: "tool", label: "Public read action", type: "select", defaultValue: "HACKERNEWS_GET_TOP_STORIES", options: [{ value: "HACKERNEWS_GET_TOP_STORIES", label: "Top story IDs" }, { value: "HACKERNEWS_GET_ITEM", label: "Item by ID" }] },
        { key: "itemId", label: "Item ID", type: "template-input", placeholder: "8863", showWhen: { field: "tool", equals: "HACKERNEWS_GET_ITEM" } },
      ],
      outputFields: [{ field: "data", description: "Public result returned by Composio" }],
    },
    {
      slug: "run-tool", label: "Run Composio Action", category: "Composio",
      description: "Run any Composio tool (for example SLACK_SEND_MESSAGE) with the workflow owner's connected account. Can read AND write.",
      stepFunction: "runComposioToolStep", stepImportPath: "run-tool",
      configFields: [
        { key: "toolkit", label: "App (toolkit slug)", type: "template-input", placeholder: "slack" },
        { key: "tool", label: "Action (tool slug)", type: "template-input", placeholder: "SLACK_SEND_MESSAGE" },
        { key: "arguments", label: "Arguments (JSON)", type: "template-input", placeholder: "{\"channel\": \"#general\", \"text\": \"hi\"}" },
      ],
      outputFields: [{ field: "data", description: "Result returned by the tool" }],
    },
  ],
};
registerIntegration(plugin);
