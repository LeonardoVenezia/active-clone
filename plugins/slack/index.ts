import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { SlackIcon } from "./icon";

const slackPlugin: IntegrationPlugin = {
  type: "slack",
  label: "Slack",
  description: "Send messages to Slack channels",

  icon: SlackIcon,

  formFields: [
    {
      id: "apiKey",
      label: "Bot Token",
      type: "password",
      placeholder: "xoxb-...",
      configKey: "apiKey",
      envVar: "SLACK_API_KEY",
      helpText: "Create a Slack app and get your Bot Token from ",
      helpLink: {
        text: "api.slack.com/apps",
        url: "https://api.slack.com/apps",
      },
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testSlack } = await import("./test");
      return testSlack;
    },
  },

  actions: [
    {
      slug: "send-message",
      label: "Send Slack Message",
      description: "Send a message to a Slack channel",
      category: "Slack",
      stepFunction: "sendSlackMessageStep",
      stepImportPath: "send-slack-message",
      outputFields: [
        { field: "ts", description: "Message timestamp" },
        { field: "channel", description: "Channel ID" },
      ],
      configFields: [
        {
          key: "slackChannel",
          label: "Channel",
          type: "text",
          placeholder: "#general or {{NodeName.channel}}",
          example: "#general",
          required: true,
        },
        {
          key: "slackMessage",
          label: "Message",
          type: "template-textarea",
          placeholder:
            "Your message. Use {{NodeName.field}} to insert data from previous nodes.",
          rows: 4,
          example: "Hello from my workflow!",
          required: true,
        },
      ],
    },
    {
      slug: "list-channels",
      label: "List Channels",
      description: "List public and private channels in the workspace",
      category: "Slack",
      stepFunction: "listChannelsStep",
      stepImportPath: "list-channels",
      outputFields: [
        { field: "channels", description: "Channels (id, name, isPrivate, memberCount)" },
        { field: "count", description: "Channels returned" },
      ],
      configFields: [
        {
          key: "limit",
          label: "Limit",
          type: "template-input",
          placeholder: "100",
          example: "100",
        },
      ],
    },
    {
      slug: "get-channel-history",
      label: "Get Channel History",
      description: "Read recent messages from a channel",
      category: "Slack",
      stepFunction: "getChannelHistoryStep",
      stepImportPath: "get-channel-history",
      outputFields: [
        { field: "messages", description: "Messages (ts, user, text)" },
        { field: "count", description: "Messages returned" },
        { field: "hasMore", description: "Whether more results exist" },
      ],
      configFields: [
        {
          key: "channelId",
          label: "Channel ID",
          type: "template-input",
          placeholder: "C01234567 (use List Channels)",
          example: "C01234567",
          required: true,
        },
        {
          key: "limit",
          label: "Limit",
          type: "template-input",
          placeholder: "20",
          example: "20",
        },
      ],
    },
    {
      slug: "list-users",
      label: "List Users",
      description: "List workspace members (id, name, email)",
      category: "Slack",
      stepFunction: "listUsersStep",
      stepImportPath: "list-users",
      outputFields: [
        { field: "users", description: "Users (id, name, realName, email, isBot)" },
        { field: "count", description: "Users returned" },
      ],
      configFields: [
        {
          key: "limit",
          label: "Limit",
          type: "template-input",
          placeholder: "100",
          example: "100",
        },
      ],
    },
    {
      slug: "update-message",
      label: "Update Message",
      description: "Edit a message the bot posted",
      category: "Slack",
      stepFunction: "updateMessageStep",
      stepImportPath: "update-message",
      outputFields: [
        { field: "ts", description: "Message timestamp" },
        { field: "channel", description: "Channel ID" },
      ],
      configFields: [
        {
          key: "channelId",
          label: "Channel ID",
          type: "template-input",
          placeholder: "C01234567 or {{SendMessage.channel}}",
          example: "C01234567",
          required: true,
        },
        {
          key: "messageTs",
          label: "Message timestamp (ts)",
          type: "template-input",
          placeholder: "{{SendMessage.ts}}",
          example: "1729000000.000100",
          required: true,
        },
        {
          key: "newText",
          label: "New text",
          type: "template-textarea",
          placeholder: "Updated message text",
          example: "Pedido entregado ✔",
          required: true,
        },
      ],
    },
    {
      slug: "delete-message",
      label: "Delete Message",
      description: "Delete a message the bot posted",
      category: "Slack",
      stepFunction: "deleteMessageStep",
      stepImportPath: "delete-message",
      outputFields: [
        { field: "ts", description: "Deleted message timestamp" },
        { field: "channel", description: "Channel ID" },
      ],
      configFields: [
        {
          key: "channelId",
          label: "Channel ID",
          type: "template-input",
          placeholder: "C01234567 or {{SendMessage.channel}}",
          example: "C01234567",
          required: true,
        },
        {
          key: "messageTs",
          label: "Message timestamp (ts)",
          type: "template-input",
          placeholder: "{{SendMessage.ts}}",
          example: "1729000000.000100",
          required: true,
        },
      ],
    },
  ],
};

// Auto-register on import
registerIntegration(slackPlugin);

export default slackPlugin;
