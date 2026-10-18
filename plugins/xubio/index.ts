import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { XubioIcon } from "./icon";

const textField = (key: string, label: string, placeholder: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  type: "template-input" as const,
  placeholder,
  example: placeholder,
  ...extra,
});

const xubioPlugin: IntegrationPlugin = {
  type: "xubio",
  label: "Xubio",
  description: "Contabilidad y facturación en Xubio",

  icon: XubioIcon,

  formFields: [
    {
      id: "clientId",
      label: "Client ID",
      type: "text",
      placeholder: "Client ID de tu App Cliente",
      configKey: "clientId",
      envVar: "XUBIO_CLIENT_ID",
      helpText: "En Xubio: Configuración > Integraciones > API de Xubio > Nueva App Cliente.",
    },
    {
      id: "secretId",
      label: "Secret ID",
      type: "password",
      placeholder: "Secret ID de tu App Cliente",
      configKey: "secretId",
      envVar: "XUBIO_SECRET_ID",
      helpText: "Se genera junto con el Client ID al crear la App Cliente.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testXubio } = await import("./test");
      return testXubio;
    },
  },

  actions: [
    {
      slug: "get-company",
      label: "Get Company",
      description: "Read your Xubio company data",
      category: "Xubio",
      stepFunction: "getCompanyStep",
      stepImportPath: "get-company",
      outputFields: [{ field: "company", description: "Company data" }],
      configFields: [],
    },
    {
      slug: "list-customers",
      label: "List Customers",
      description: "List customers, optionally filtered",
      category: "Xubio",
      stepFunction: "listCustomersStep",
      stepImportPath: "list-customers",
      outputFields: [
        { field: "count", description: "Number of customers" },
        { field: "customers", description: "Customers" },
      ],
      configFields: [
        textField("name", "Name", "Acme SA"),
        textField("email", "Email", "cliente@correo.com"),
        textField("taxId", "CUIT / tax ID", "30712345678"),
      ],
    },
    {
      slug: "list-sales-invoices",
      label: "List Sales Invoices",
      description: "List sales invoices in a date range",
      category: "Xubio",
      stepFunction: "listSalesInvoicesStep",
      stepImportPath: "list-sales-invoices",
      outputFields: [
        { field: "count", description: "Number of invoices" },
        { field: "invoices", description: "Invoices" },
      ],
      configFields: [
        textField("fromDate", "From date (YYYY-MM-DD)", "2026-10-01"),
        textField("toDate", "To date (YYYY-MM-DD)", "2026-10-31"),
      ],
    },
    {
      slug: "get-sales-invoice",
      label: "Get Sales Invoice",
      description: "Read one sales invoice by its Xubio ID",
      category: "Xubio",
      stepFunction: "getSalesInvoiceStep",
      stepImportPath: "get-sales-invoice",
      outputFields: [{ field: "invoice", description: "Invoice data" }],
      configFields: [textField("invoiceId", "Invoice ID", "123456", { required: true })],
    },
    {
      slug: "create-customer",
      label: "Create Customer",
      description: "Create a customer (cliente) in Xubio",
      category: "Xubio",
      stepFunction: "createCustomerStep",
      stepImportPath: "create-customer",
      outputFields: [
        { field: "customerId", description: "Customer ID (cliente_id)" },
        { field: "name", description: "Customer name" },
      ],
      configFields: [
        {
          key: "name",
          label: "Name / razón social",
          type: "template-input",
          placeholder: "Distribuidora del Sur SA",
          example: "Distribuidora del Sur SA",
          required: true,
        },
        {
          key: "taxIdType",
          label: "Tax ID type (CUIT, CUIL, DNI)",
          type: "template-input",
          placeholder: "CUIT",
          example: "CUIT",
        },
        {
          key: "cuit",
          label: "CUIT (with dashes, required to invoice)",
          type: "template-input",
          placeholder: "30-71555555-3",
          example: "30-71555555-3",
        },
        {
          key: "fiscalCategory",
          label: "Fiscal category (RI, MT, CF, EX, NA, CE)",
          type: "template-input",
          placeholder: "CF",
          example: "CF",
        },
        {
          key: "email",
          label: "Email",
          type: "template-input",
          placeholder: "cliente@example.com",
          example: "cliente@example.com",
        },
        {
          type: "group",
          label: "Address",
          fields: [
            {
              key: "phone",
              label: "Phone",
              type: "template-input",
              placeholder: "1122334455",
              example: "1122334455",
            },
            {
              key: "address",
              label: "Address",
              type: "template-input",
              placeholder: "Av. Siempre Viva 123",
              example: "Av. Siempre Viva 123",
            },
            {
              key: "postalCode",
              label: "Postal code",
              type: "template-input",
              placeholder: "1405",
              example: "1405",
            },
          ],
        },
      ],
    },
  ],
};

registerIntegration(xubioPlugin);

export default xubioPlugin;
