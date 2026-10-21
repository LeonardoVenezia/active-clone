import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { StripeIcon } from "./icon";

const stripePlugin: IntegrationPlugin = {
  type: "stripe",
  label: "Stripe",
  description: "Payment processing and billing",

  icon: StripeIcon,

  formFields: [
    {
      id: "apiKey",
      label: "Secret Key",
      type: "password",
      placeholder: "sk_live_... or sk_test_...",
      configKey: "apiKey",
      envVar: "STRIPE_SECRET_KEY",
      helpText: "Get your secret key from ",
      helpLink: {
        text: "dashboard.stripe.com/apikeys",
        url: "https://dashboard.stripe.com/apikeys",
      },
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testStripe } = await import("./test");
      return testStripe;
    },
  },

  actions: [
    {
      slug: "create-customer",
      label: "Create Customer",
      description: "Create a new customer in Stripe",
      category: "Stripe",
      stepFunction: "createCustomerStep",
      stepImportPath: "create-customer",
      outputFields: [
        { field: "id", description: "Customer ID" },
        { field: "email", description: "Customer email" },
      ],
      configFields: [
        {
          key: "email",
          label: "Email",
          type: "template-input",
          placeholder: "customer@example.com or {{NodeName.email}}",
          example: "customer@example.com",
          required: true,
        },
        {
          key: "name",
          label: "Name",
          type: "template-input",
          placeholder: "John Doe or {{NodeName.name}}",
          example: "John Doe",
        },
        {
          key: "phone",
          label: "Phone",
          type: "template-input",
          placeholder: "+1234567890",
          example: "+1234567890",
        },
        {
          type: "group",
          label: "Additional Details",
          fields: [
            {
              key: "description",
              label: "Description",
              type: "template-input",
              placeholder: "Internal notes about this customer",
              example: "VIP customer",
            },
            {
              key: "metadata",
              label: "Metadata (JSON)",
              type: "template-textarea",
              placeholder: '{"key": "value"}',
              example: '{"plan": "enterprise", "source": "website"}',
              rows: 3,
            },
          ],
        },
      ],
    },
    {
      slug: "get-customer",
      label: "Get Customer",
      description: "Retrieve a customer by ID or email",
      category: "Stripe",
      stepFunction: "getCustomerStep",
      stepImportPath: "get-customer",
      outputFields: [
        { field: "id", description: "Customer ID" },
        { field: "email", description: "Customer email" },
        { field: "name", description: "Customer name" },
        { field: "created", description: "Creation timestamp" },
      ],
      configFields: [
        {
          key: "customerId",
          label: "Customer ID",
          type: "template-input",
          placeholder: "cus_... or {{NodeName.customerId}}",
          example: "cus_ABC123",
        },
        {
          key: "email",
          label: "Email (alternative lookup)",
          type: "template-input",
          placeholder: "customer@example.com",
          example: "customer@example.com",
        },
      ],
    },
    {
      slug: "create-invoice",
      label: "Create Invoice",
      description: "Create and optionally send an invoice",
      category: "Stripe",
      stepFunction: "createInvoiceStep",
      stepImportPath: "create-invoice",
      outputFields: [
        { field: "id", description: "Invoice ID" },
        { field: "number", description: "Invoice number" },
        { field: "hostedInvoiceUrl", description: "Hosted invoice URL" },
        { field: "status", description: "Invoice status" },
      ],
      configFields: [
        {
          key: "customerId",
          label: "Customer ID",
          type: "template-input",
          placeholder: "cus_... or {{NodeName.customerId}}",
          example: "cus_ABC123",
          required: true,
        },
        {
          key: "description",
          label: "Description",
          type: "template-input",
          placeholder: "Invoice description",
          example: "Professional services - January 2024",
        },
        {
          key: "lineItems",
          label: "Line Items (JSON array)",
          type: "template-textarea",
          placeholder: '[{"description": "Item", "amount": 1000, "quantity": 1}]',
          example:
            '[{"description": "Consulting", "amount": 15000, "quantity": 2}]',
          rows: 4,
          required: true,
        },
        {
          type: "group",
          label: "Invoice Options",
          fields: [
            {
              key: "daysUntilDue",
              label: "Days Until Due",
              type: "number",
              defaultValue: "30",
              min: 1,
            },
            {
              key: "autoAdvance",
              label: "Auto-finalize",
              type: "select",
              options: [
                { value: "true", label: "Yes" },
                { value: "false", label: "No (draft)" },
              ],
              defaultValue: "true",
            },
            {
              key: "collectionMethod",
              label: "Collection Method",
              type: "select",
              options: [
                { value: "send_invoice", label: "Send Invoice" },
                { value: "charge_automatically", label: "Charge Automatically" },
              ],
              defaultValue: "send_invoice",
            },
            {
              key: "metadata",
              label: "Metadata (JSON)",
              type: "template-textarea",
              placeholder: '{"key": "value"}',
              example: '{"project": "website-redesign"}',
              rows: 3,
            },
          ],
        },
      ],
    },
    {
      slug: "search-customers",
      label: "Search Customers",
      description: "List customers, optionally filtered by email",
      category: "Stripe",
      stepFunction: "searchCustomersStep",
      stepImportPath: "search-customers",
      outputFields: [
        { field: "customers", description: "Customers (id, email, name, created)" },
        { field: "count", description: "Customers returned" },
      ],
      configFields: [
        {
          key: "email",
          label: "Email (optional filter)",
          type: "template-input",
          placeholder: "customer@example.com",
          example: "customer@example.com",
        },
        {
          key: "limit",
          label: "Limit",
          type: "template-input",
          placeholder: "10",
          example: "10",
        },
      ],
    },
    {
      slug: "get-payment",
      label: "Get Payment",
      description: "Retrieve a Payment Intent by ID (status, amount, currency)",
      category: "Stripe",
      stepFunction: "getPaymentStep",
      stepImportPath: "get-payment",
      outputFields: [
        { field: "id", description: "Payment Intent ID" },
        { field: "status", description: "Payment status" },
        { field: "amount", description: "Amount in cents" },
        { field: "currency", description: "Currency" },
      ],
      configFields: [
        {
          key: "paymentIntentId",
          label: "Payment Intent ID",
          type: "template-input",
          placeholder: "pi_... or {{NodeName.paymentId}}",
          example: "pi_ABC123",
          required: true,
        },
      ],
    },
    {
      slug: "list-payments",
      label: "List Payments",
      description: "List Payment Intents, optionally filtered by customer",
      category: "Stripe",
      stepFunction: "listPaymentsStep",
      stepImportPath: "list-payments",
      outputFields: [
        { field: "payments", description: "Payments (id, status, amount, currency, customerId, created)" },
        { field: "count", description: "Payments returned" },
        { field: "hasMore", description: "Whether more results exist" },
      ],
      configFields: [
        {
          key: "customerId",
          label: "Customer ID (optional filter)",
          type: "template-input",
          placeholder: "cus_...",
          example: "cus_ABC123",
        },
        {
          key: "limit",
          label: "Limit",
          type: "template-input",
          placeholder: "10",
          example: "10",
        },
      ],
    },
    {
      slug: "create-payment-link",
      label: "Create Payment Link",
      description: "Create a shareable Stripe Payment Link for an existing price",
      category: "Stripe",
      stepFunction: "createPaymentLinkStep",
      stepImportPath: "create-payment-link",
      outputFields: [
        { field: "id", description: "Payment Link ID" },
        { field: "url", description: "Shareable checkout URL" },
      ],
      configFields: [
        {
          key: "priceId",
          label: "Price ID",
          type: "template-input",
          placeholder: "price_... (from your Stripe dashboard)",
          example: "price_ABC123",
          required: true,
        },
        {
          key: "quantity",
          label: "Quantity",
          type: "template-input",
          placeholder: "1",
          example: "1",
        },
      ],
    },
  ],
};

registerIntegration(stripePlugin);

export default stripePlugin;

