import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { AlegraIcon } from "./icon";

const textField = (key: string, label: string, placeholder: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  type: "template-input" as const,
  placeholder,
  example: placeholder,
  ...extra,
});

const alegraPlugin: IntegrationPlugin = {
  type: "alegra",
  label: "Alegra",
  description: "Contabilidad y facturación en Alegra",

  icon: AlegraIcon,

  formFields: [
    {
      id: "email",
      label: "Email",
      type: "text",
      placeholder: "El email de tu usuario de Alegra",
      configKey: "email",
      envVar: "ALEGRA_EMAIL",
      helpText: "El email que Alegra muestra en Configuración > API - Integraciones con otros sistemas.",
    },
    {
      id: "token",
      label: "API Token",
      type: "password",
      placeholder: "Token de la API de Alegra",
      configKey: "token",
      envVar: "ALEGRA_TOKEN",
      helpText: "Se genera en Configuración > API - Integraciones con otros sistemas.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testAlegra } = await import("./test");
      return testAlegra;
    },
  },

  actions: [
    {
      slug: "get-company",
      label: "Get Company",
      description: "Read your Alegra company data",
      category: "Alegra",
      stepFunction: "getCompanyStep",
      stepImportPath: "get-company",
      outputFields: [{ field: "company", description: "Company data" }],
      configFields: [],
    },
    {
      slug: "list-contacts",
      label: "List Contacts",
      description: "List contacts (customers and suppliers), optionally filtered",
      category: "Alegra",
      stepFunction: "listContactsStep",
      stepImportPath: "list-contacts",
      outputFields: [
        { field: "count", description: "Number of contacts" },
        { field: "contacts", description: "Contacts" },
      ],
      configFields: [
        textField("query", "Search text", "Acme"),
        textField("type", "Type (client or provider)", "client"),
        textField("limit", "Max results", "30"),
      ],
    },
    {
      slug: "list-invoices",
      label: "List Invoices",
      description: "List sales invoices",
      category: "Alegra",
      stepFunction: "listInvoicesStep",
      stepImportPath: "list-invoices",
      outputFields: [
        { field: "count", description: "Number of invoices" },
        { field: "invoices", description: "Invoices" },
      ],
      configFields: [
        textField("start", "Start from (position)", "0"),
        textField("limit", "Max results", "30"),
      ],
    },
    {
      slug: "get-invoice",
      label: "Get Invoice",
      description: "Read one sales invoice by its Alegra ID",
      category: "Alegra",
      stepFunction: "getInvoiceStep",
      stepImportPath: "get-invoice",
      outputFields: [{ field: "invoice", description: "Invoice data" }],
      configFields: [textField("invoiceId", "Invoice ID", "123", { required: true })],
    },
  ],
};

registerIntegration(alegraPlugin);

export default alegraPlugin;
