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
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testVtex } = await import("./test");
      return testVtex;
    },
  },

  actions: [
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
