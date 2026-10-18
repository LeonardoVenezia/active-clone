import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { MercadoPagoIcon } from "./icon";

const mercadoPagoPlugin: IntegrationPlugin = {
  type: "mercadopago",
  label: "Mercado Pago",
  description: "Cobros con link de pago, consulta de pagos y reembolsos",

  icon: MercadoPagoIcon,

  formFields: [
    {
      id: "accessToken",
      label: "Access Token",
      type: "password",
      placeholder: "APP_USR-... o TEST-...",
      configKey: "accessToken",
      envVar: "MERCADOPAGO_ACCESS_TOKEN",
      helpText:
        "Copiá el access token de tu aplicación (de prueba o de producción) desde ",
      helpLink: {
        text: "mercadopago.com.ar/developers/panel/app",
        url: "https://www.mercadopago.com.ar/developers/panel/app",
      },
    },
    {
      id: "webhookSecret",
      label: "Webhook Secret (optional)",
      type: "password",
      placeholder: "Clave secreta de Webhooks",
      configKey: "webhookSecret",
      envVar: "MERCADOPAGO_WEBHOOK_SECRET",
      helpText:
        "Needed to receive payment notifications. Copy it from Webhooks > Configure notifications in ",
      helpLink: {
        text: "mercadopago.com.ar/developers/panel/app",
        url: "https://www.mercadopago.com.ar/developers/panel/app",
      },
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testMercadoPago } = await import("./test");
      return testMercadoPago;
    },
  },

  triggers: [
    {
      slug: "payment-updated",
      label: "Payment Created or Updated",
      description:
        "A payment was created or changed status. Use Get Payment with the paymentId to read it.",
      category: "Mercado Pago",
      configFields: [],
      outputFields: [
        { field: "paymentId", description: "Payment ID" },
        { field: "action", description: "payment.created or payment.updated" },
        { field: "liveMode", description: "true for real payments" },
      ],
    },
  ],

  webhook: {
    getHandler: async () => {
      const { mercadoPagoWebhook } = await import("./webhook");
      return mercadoPagoWebhook;
    },
  },

  actions: [
    {
      slug: "create-payment-link",
      label: "Create Payment Link",
      description: "Create a Mercado Pago payment link (Checkout Pro)",
      category: "Mercado Pago",
      stepFunction: "createPaymentLinkStep",
      stepImportPath: "create-payment-link",
      outputFields: [
        { field: "id", description: "Preference ID" },
        { field: "url", description: "Payment link to send to the customer" },
        { field: "sandboxUrl", description: "Link for test accounts" },
        { field: "externalReference", description: "Your reference" },
        { field: "expiresAt", description: "Expiration date" },
      ],
      configFields: [
        {
          key: "title",
          label: "Title",
          type: "template-input",
          placeholder: "Product name or {{NodeName.title}}",
          example: "Remera negra talle M",
          required: true,
        },
        {
          key: "unitPrice",
          label: "Unit Price",
          type: "template-input",
          placeholder: "1500 or {{NodeName.total}}",
          example: "1500",
          required: true,
        },
        {
          key: "quantity",
          label: "Quantity",
          type: "template-input",
          placeholder: "1",
          example: "1",
        },
        {
          key: "currency",
          label: "Currency",
          type: "select",
          options: [
            { value: "ARS", label: "ARS" },
            { value: "BRL", label: "BRL" },
            { value: "CLP", label: "CLP" },
            { value: "COP", label: "COP" },
            { value: "MXN", label: "MXN" },
            { value: "UYU", label: "UYU" },
            { value: "PEN", label: "PEN" },
          ],
          defaultValue: "ARS",
        },
        {
          type: "group",
          label: "Additional Details",
          fields: [
            {
              key: "externalReference",
              label: "External Reference",
              type: "template-input",
              placeholder: "order-1234 or {{NodeName.orderId}}",
              example: "order-1234",
            },
            {
              key: "successUrl",
              label: "Success URL",
              type: "template-input",
              placeholder: "https://mytienda.com/gracias",
              example: "https://mytienda.com/gracias",
            },
            {
              key: "notificationUrl",
              label: "Notification URL",
              type: "template-input",
              placeholder: "https://...",
              example: "https://mytienda.com/webhooks/mp",
            },
            {
              key: "expirationDate",
              label: "Expiration Date",
              type: "template-input",
              placeholder: "2026-12-31T23:59:59-03:00",
              example: "2026-12-31T23:59:59-03:00",
            },
          ],
        },
      ],
    },
    {
      slug: "get-payment",
      label: "Get Payment",
      description: "Get a payment by its ID",
      category: "Mercado Pago",
      stepFunction: "getPaymentStep",
      stepImportPath: "get-payment",
      outputFields: [
        { field: "id", description: "Payment ID" },
        { field: "status", description: "approved, pending, rejected, ..." },
        { field: "statusDetail", description: "Status detail" },
        { field: "amount", description: "Transaction amount" },
        { field: "currency", description: "Currency" },
        { field: "externalReference", description: "Your reference" },
        { field: "payerEmail", description: "Payer email" },
        { field: "paymentMethod", description: "Payment method" },
        { field: "dateApproved", description: "Approval date" },
      ],
      configFields: [
        {
          key: "paymentId",
          label: "Payment ID",
          type: "template-input",
          placeholder: "123456789 or {{NodeName.paymentId}}",
          example: "123456789",
          required: true,
        },
      ],
    },
    {
      slug: "search-payments",
      label: "Search Payments",
      description: "Search payments by reference, status or date",
      category: "Mercado Pago",
      stepFunction: "searchPaymentsStep",
      stepImportPath: "search-payments",
      outputFields: [
        { field: "payments", description: "List of payments" },
        { field: "count", description: "Payments returned" },
        { field: "total", description: "Total matching payments" },
      ],
      configFields: [
        {
          key: "externalReference",
          label: "External Reference",
          type: "template-input",
          placeholder: "order-1234 or {{NodeName.orderId}}",
          example: "order-1234",
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "any", label: "Any" },
            { value: "approved", label: "Approved" },
            { value: "pending", label: "Pending" },
            { value: "in_process", label: "In process" },
            { value: "rejected", label: "Rejected" },
            { value: "cancelled", label: "Cancelled" },
            { value: "refunded", label: "Refunded" },
          ],
          defaultValue: "any",
        },
        {
          type: "group",
          label: "Date range and limit",
          fields: [
            {
              key: "beginDate",
              label: "From",
              type: "template-input",
              placeholder: "NOW-7DAYS or 2026-10-01T00:00:00.000-03:00",
              example: "NOW-7DAYS",
            },
            {
              key: "endDate",
              label: "To",
              type: "template-input",
              placeholder: "NOW",
              example: "NOW",
            },
            {
              key: "limit",
              label: "Limit",
              type: "number",
              placeholder: "30",
              min: 1,
            },
          ],
        },
      ],
    },
    {
      slug: "refund-payment",
      label: "Refund Payment",
      description: "Refund a payment, fully or partially",
      category: "Mercado Pago",
      stepFunction: "refundPaymentStep",
      stepImportPath: "refund-payment",
      outputFields: [
        { field: "id", description: "Refund ID" },
        { field: "paymentId", description: "Payment ID" },
        { field: "amount", description: "Refunded amount" },
        { field: "status", description: "Refund status" },
      ],
      configFields: [
        {
          key: "paymentId",
          label: "Payment ID",
          type: "template-input",
          placeholder: "123456789 or {{NodeName.paymentId}}",
          example: "123456789",
          required: true,
        },
        {
          key: "amount",
          label: "Amount (empty = full refund)",
          type: "template-input",
          placeholder: "Leave empty to refund everything",
          example: "500",
        },
      ],
    },
    {
      slug: "create-customer",
      label: "Create Customer",
      description: "Create a customer to save cards and charge later",
      category: "Mercado Pago",
      stepFunction: "createCustomerStep",
      stepImportPath: "create-customer",
      outputFields: [
        { field: "id", description: "Customer ID" },
        { field: "email", description: "Customer email" },
        { field: "firstName", description: "First name" },
        { field: "lastName", description: "Last name" },
      ],
      configFields: [
        {
          key: "email",
          label: "Email",
          type: "template-input",
          placeholder: "comprador@email.com",
          example: "comprador@email.com",
          required: true,
        },
        {
          key: "firstName",
          label: "First name",
          type: "template-input",
          placeholder: "Juan",
          example: "Juan",
        },
        {
          key: "lastName",
          label: "Last name",
          type: "template-input",
          placeholder: "Pérez",
          example: "Pérez",
        },
      ],
    },
    {
      slug: "search-customers",
      label: "Search Customers",
      description: "Find customers, optionally by email",
      category: "Mercado Pago",
      stepFunction: "searchCustomersStep",
      stepImportPath: "search-customers",
      outputFields: [
        { field: "customers", description: "List of customers" },
        { field: "count", description: "Customers returned" },
      ],
      configFields: [
        {
          key: "email",
          label: "Email",
          type: "template-input",
          placeholder: "comprador@email.com (optional)",
          example: "",
        },
      ],
    },
    {
      slug: "list-cards",
      label: "List Customer Cards",
      description: "List a customer's saved cards",
      category: "Mercado Pago",
      stepFunction: "listCardsStep",
      stepImportPath: "list-cards",
      outputFields: [
        { field: "cards", description: "List of saved cards" },
        { field: "count", description: "Cards returned" },
      ],
      configFields: [
        {
          key: "customerId",
          label: "Customer ID",
          type: "template-input",
          placeholder: "1469979538-vLQzQB or {{Create Customer.id}}",
          example: "1469979538-vLQzQB",
          required: true,
        },
      ],
    },
  ],
};

registerIntegration(mercadoPagoPlugin);

export default mercadoPagoPlugin;
