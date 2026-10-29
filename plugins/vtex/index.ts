import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { VtexIcon } from "./icon";

const vtexPlugin: IntegrationPlugin = {
  type: "vtex",
  label: "VTEX",
  description: "Pedidos de tu tienda VTEX",

  icon: VtexIcon,

  formFields: [
    {
      id: "accountName",
      label: "Account Name",
      type: "text",
      placeholder: "mitienda",
      configKey: "accountName",
      envVar: "VTEX_ACCOUNT_NAME",
      helpText: "El nombre de tu cuenta VTEX (lo que va antes de .myvtex.com).",
    },
    {
      id: "environment",
      label: "Environment",
      type: "text",
      placeholder: "vtexcommercestable",
      configKey: "environment",
      envVar: "VTEX_ENVIRONMENT",
      helpText: "Dejalo vacío para usar vtexcommercestable.",
    },
    {
      id: "appKey",
      label: "App Key",
      type: "text",
      placeholder: "vtexappkey-mitienda-XXXXXX",
      configKey: "appKey",
      envVar: "VTEX_APP_KEY",
      helpText: "Clave de aplicación creada en VTEX Admin, con permiso de Order Management.",
    },
    {
      id: "appToken",
      label: "App Token",
      type: "password",
      placeholder: "Token secreto de la clave",
      configKey: "appToken",
      envVar: "VTEX_APP_TOKEN",
      helpText: "Se muestra una sola vez al crear la clave.",
    },
    {
      id: "hookSecret",
      label: "Hook Secret",
      type: "password",
      placeholder: "Cualquier texto secreto largo",
      configKey: "hookSecret",
      envVar: "VTEX_HOOK_SECRET",
      helpText: "Solo para el trigger de pedidos: VTEX lo envía en cada aviso para comprobar que viene de tu tienda.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testVtex } = await import("./test");
      return testVtex;
    },
  },

  triggers: [
    {
      slug: "order-status-changed",
      label: "Order Status Changed",
      description: "An order changed status (Order Hook). Set it up with the Setup Order Hook action.",
      category: "VTEX",
      configFields: [],
      outputFields: [
        { field: "orderId", description: "Order ID (use Get Order to read it)" },
        { field: "state", description: "New order status, e.g. payment-approved" },
        { field: "lastChange", description: "When it changed" },
      ],
    },
  ],

  webhook: {},

  actions: [
    {
      slug: "setup-order-hook",
      label: "Setup Order Hook",
      description: "Register VTEX's Order Hook so order status changes trigger workflows (run once)",
      category: "VTEX",
      stepFunction: "setupOrderHookStep",
      stepImportPath: "setup-order-hook",
      outputFields: [{ field: "url", description: "Registered URL" }],
      configFields: [
        {
          key: "notificationUrl",
          label: "Notification URL",
          type: "template-input",
          placeholder: "Copy it from the trigger panel",
          example: "https://active-clone.vercel.app/api/integrations/webhooks/vtex/CONNECTION_ID",
          required: true,
        },
        {
          key: "statuses",
          label: "Only these statuses (comma separated)",
          type: "template-input",
          placeholder: "Empty = every status change",
          example: "payment-approved,ready-for-handling",
        },
      ],
    },
    {
      slug: "get-order",
      label: "Get Order",
      description: "Get an order by its ID",
      category: "VTEX",
      stepFunction: "getOrderStep",
      stepImportPath: "get-order",
      outputFields: [
        { field: "orderId", description: "Order ID" },
        { field: "status", description: "Order status" },
        { field: "statusDescription", description: "Status description" },
        { field: "value", description: "Total in cents" },
        { field: "customerName", description: "Customer name" },
        { field: "customerEmail", description: "Customer email" },
        { field: "items", description: "Items in the order" },
      ],
      configFields: [
        {
          key: "orderId",
          label: "Order ID",
          type: "template-input",
          placeholder: "1234567890123-01",
          example: "1234567890123-01",
          required: true,
        },
      ],
    },
    {
      slug: "list-orders",
      label: "List Orders",
      description: "List recent orders, optionally by text or status",
      category: "VTEX",
      stepFunction: "listOrdersStep",
      stepImportPath: "list-orders",
      outputFields: [
        { field: "orders", description: "List of orders" },
        { field: "count", description: "Orders returned" },
        { field: "total", description: "Total matches" },
      ],
      configFields: [
        {
          key: "query",
          label: "Search",
          type: "template-input",
          placeholder: "Order ID, customer name or email",
          example: "",
        },
        {
          key: "status",
          label: "Status",
          type: "template-input",
          placeholder: "ready-for-handling, handling, invoiced...",
          example: "handling",
        },
        {
          key: "perPage",
          label: "Max results",
          type: "template-input",
          placeholder: "15",
          example: "15",
        },
      ],
    },
    {
      slug: "start-handling",
      label: "Start Handling",
      description: "Move an order from ready-for-handling to handling",
      category: "VTEX",
      stepFunction: "startHandlingStep",
      stepImportPath: "start-handling",
      outputFields: [
        { field: "orderId", description: "Order ID" },
      ],
      configFields: [
        {
          key: "orderId",
          label: "Order ID",
          type: "template-input",
          placeholder: "1234567890123-01",
          example: "1234567890123-01",
          required: true,
        },
      ],
    },
  ],
};

registerIntegration(vtexPlugin);

export default vtexPlugin;
