import { Blocks } from "lucide-react";
import { type IntegrationPlugin, registerIntegration } from "../registry";

const plugin: IntegrationPlugin = {
  type: "composio",
  label: "Composio",
  description: "Discover toolkits and read public Hacker News data. Project key is configured server-side; OAuth apps are not connected yet.",
  icon: Blocks,
  formFields: [],
  actions: [
    {
      slug: "discover", label: "Discover Composio Tools", category: "Composio",
      description: "List available toolkits or inspect Hacker News tool schemas. Does not execute tools.",
      stepFunction: "discoverComposioStep", stepImportPath: "catalog",
      configFields: [
        { key: "catalog", label: "Catalog", type: "select", defaultValue: "toolkits", options: [{ value: "toolkits", label: "Toolkits" }, { value: "hackernews", label: "Hacker News tools" }] },
        { key: "search", label: "Search", type: "template-input", placeholder: "hackernews" },
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
  ],
};
registerIntegration(plugin);
