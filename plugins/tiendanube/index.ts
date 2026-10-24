import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { TiendanubeIcon } from "./icon";

const orderStatusOptions = [
  { value: "any", label: "Any" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

const tiendanubePlugin: IntegrationPlugin = {
  type: "tiendanube",
  label: "Tiendanube",
  description: "Pedidos, productos y stock de tu tienda Tiendanube",

  icon: TiendanubeIcon,

  formFields: [
    {
      id: "storeId",
      label: "Store ID",
      type: "text",
      placeholder: "123456",
      configKey: "storeId",
      envVar: "TIENDANUBE_STORE_ID",
      helpText:
        "Se completa solo al instalar la app en tu tienda desde Tiendanube. Para pruebas manuales, es el user_id que devuelve la autorización.",
    },
    {
      id: "accessToken",
      label: "Access Token",
      type: "password",
      placeholder: "Token de acceso de la tienda",
      configKey: "accessToken",
      envVar: "TIENDANUBE_ACCESS_TOKEN",
      helpText: "Token que Tiendanube entrega al instalar la app. Ver ",
      helpLink: {
        text: "tiendanube.dev/docs/applications/authentication",
        url: "https://tiendanube.dev/docs/applications/authentication",
      },
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testTiendanube } = await import("./test");
      return testTiendanube;
    },
  },

  triggers: [
    {
      slug: "order-created",
      label: "Order Created",
      description: "A new order was created in the store.",
      category: "Tiendanube",
      configFields: [],
      outputFields: [
        { field: "orderId", description: "Order ID (use Get Order to read it)" },
        { field: "storeId", description: "Store ID" },
      ],
    },
    {
      slug: "order-paid",
      label: "Order Paid",
      description: "An order was paid.",
      category: "Tiendanube",
      configFields: [],
      outputFields: [
        { field: "orderId", description: "Order ID (use Get Order to read it)" },
        { field: "storeId", description: "Store ID" },
      ],
    },
    {
      slug: "order-cancelled",
      label: "Order Cancelled",
      description: "An order was cancelled.",
      category: "Tiendanube",
      configFields: [],
      outputFields: [
        { field: "orderId", description: "Order ID (use Get Order to read it)" },
        { field: "storeId", description: "Store ID" },
      ],
    },
    {
      slug: "product-updated",
      label: "Product Updated",
      description: "A product was changed (price, stock, details).",
      category: "Tiendanube",
      configFields: [],
      outputFields: [
        {
          field: "productId",
          description: "Product ID (use Get Product to read it)",
        },
        { field: "storeId", description: "Store ID" },
      ],
    },
  ],

  webhook: {
    getHandler: async () => {
      const { tiendanubeWebhook } = await import("./webhook");
      return tiendanubeWebhook;
    },
  },

  actions: [
    {
      slug: "get-order",
      label: "Get Order",
      description: "Get an order by its ID",
      category: "Tiendanube",
      stepFunction: "getOrderStep",
      stepImportPath: "get-order",
      outputFields: [
        { field: "id", description: "Order ID" },
        { field: "number", description: "Order number shown to the customer" },
        { field: "status", description: "open, closed or cancelled" },
        { field: "paymentStatus", description: "Payment status" },
        { field: "shippingStatus", description: "Shipping status" },
        { field: "total", description: "Order total" },
        { field: "currency", description: "Currency" },
        { field: "customerEmail", description: "Customer email" },
        { field: "customerName", description: "Customer name" },
        { field: "customerPhone", description: "Customer phone" },
        { field: "products", description: "Products in the order" },
      ],
      configFields: [
        {
          key: "orderId",
          label: "Order ID",
          type: "template-input",
          placeholder: "123456789 or {{Trigger.orderId}}",
          example: "123456789",
          required: true,
        },
      ],
    },
    {
      slug: "list-products",
      label: "List Products",
      description: "List store products with stock per variant",
      category: "Tiendanube",
      stepFunction: "listProductsStep",
      stepImportPath: "list-products",
      outputFields: [
        { field: "products", description: "List of products (id, name, totalStock, variants: id, sku, price, stock)" },
        { field: "count", description: "Products returned" },
      ],
      configFields: [
        {
          key: "query",
          label: "Search",
          type: "template-input",
          placeholder: "Product name",
          example: "remera",
        },
        {
          key: "limit",
          label: "Limit",
          type: "template-input",
          placeholder: "50",
          example: "50",
        },
      ],
    },
    {
      slug: "search-orders",
      label: "Search Orders",
      description: "Search orders by text, status or date. Returns SUMMARY fields only (id, number, status, paymentStatus, shippingStatus, total, currency, customerEmail, customerName, createdAt). To read the FULL detail of one order (products, shipping id, etc.) follow with a Get Order step using the order id.",
      category: "Tiendanube",
      stepFunction: "searchOrdersStep",
      stepImportPath: "search-orders",
      outputFields: [
        { field: "orders", description: "List of orders (id, number, status, paymentStatus, shippingStatus, total, currency, customerEmail, customerName, createdAt)" },
        { field: "count", description: "Orders returned" },
      ],
      configFields: [
        {
          key: "query",
          label: "Search",
          type: "template-input",
          placeholder: "Order number, customer name or email",
          example: "100",
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: orderStatusOptions,
          defaultValue: "any",
        },
        {
          type: "group",
          label: "More filters",
          fields: [
            {
              key: "paymentStatus",
              label: "Payment status",
              type: "select",
              options: [
                { value: "any", label: "Any" },
                { value: "pending", label: "Pending" },
                { value: "authorized", label: "Authorized" },
                { value: "paid", label: "Paid" },
                { value: "abandoned", label: "Abandoned" },
                { value: "refunded", label: "Refunded" },
                { value: "voided", label: "Voided" },
              ],
              defaultValue: "any",
            },
            {
              key: "shippingStatus",
              label: "Shipping status",
              type: "select",
              options: [
                { value: "any", label: "Any" },
                { value: "unpacked", label: "Unpacked" },
                { value: "unfulfilled", label: "Not shipped" },
                { value: "fulfilled", label: "Shipped" },
              ],
              defaultValue: "any",
            },
            {
              key: "createdAtMin",
              label: "Created after",
              type: "template-input",
              placeholder: "2026-10-01T00:00:00-03:00",
              example: "2026-10-01T00:00:00-03:00",
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
      slug: "get-product",
      label: "Get Product",
      description: "Get a product and its variants by ID or SKU",
      category: "Tiendanube",
      stepFunction: "getProductStep",
      stepImportPath: "get-product",
      outputFields: [
        { field: "id", description: "Product ID" },
        { field: "name", description: "Product name" },
        { field: "description", description: "Product description as plain text (empty when the store has none)" },
        { field: "published", description: "Visible in the store" },
        { field: "variants", description: "Variants with SKU, price and stock" },
      ],
      configFields: [
        {
          key: "productId",
          label: "Product ID",
          type: "template-input",
          placeholder: "123456 or {{Trigger.productId}}",
          example: "123456",
        },
        {
          key: "sku",
          label: "SKU (used if no Product ID)",
          type: "template-input",
          placeholder: "REM-NEG-M",
          example: "REM-NEG-M",
        },
      ],
    },
    {
      slug: "update-stock",
      label: "Update Stock",
      description: "Set or adjust the stock of a product variant",
      category: "Tiendanube",
      stepFunction: "updateStockStep",
      stepImportPath: "update-stock",
      outputFields: [
        { field: "updated", description: "Updated variants with new stock" },
      ],
      configFields: [
        {
          key: "productId",
          label: "Product ID",
          type: "template-input",
          placeholder: "123456 or {{Trigger.productId}}",
          example: "123456",
          required: true,
        },
        {
          key: "variantId",
          label: "Variant ID (empty = all variants)",
          type: "template-input",
          placeholder: "Leave empty to change every variant",
          example: "789",
        },
        {
          key: "mode",
          label: "Mode",
          type: "select",
          options: [
            { value: "replace", label: "Set stock to" },
            { value: "variation", label: "Add / remove (negative removes)" },
          ],
          defaultValue: "replace",
        },
        {
          key: "quantity",
          label: "Quantity",
          type: "template-input",
          placeholder: "10",
          example: "10",
          required: true,
        },
      ],
    },
    {
      slug: "search-customers",
      label: "Search Customers",
      description: "List customers, optionally by email or text",
      category: "Tiendanube",
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
          placeholder: "cliente@email.com (optional)",
          example: "",
        },
        {
          key: "query",
          label: "Search text",
          type: "template-input",
          placeholder: "Name, email or ID number (optional)",
          example: "",
        },
        {
          key: "limit",
          label: "Max results",
          type: "template-input",
          placeholder: "30",
          example: "30",
        },
      ],
    },
    {
      slug: "get-customer",
      label: "Get Customer",
      description: "Get a customer by ID",
      category: "Tiendanube",
      stepFunction: "getCustomerStep",
      stepImportPath: "get-customer",
      outputFields: [
        { field: "id", description: "Customer ID" },
        { field: "name", description: "Name" },
        { field: "email", description: "Email" },
        { field: "phone", description: "Phone" },
        { field: "identification", description: "ID number" },
        { field: "totalSpent", description: "Total spent" },
        { field: "createdAt", description: "Created at" },
      ],
      configFields: [
        {
          key: "customerId",
          label: "Customer ID",
          type: "template-input",
          placeholder: "123456789",
          example: "123456789",
          required: true,
        },
      ],
    },
    {
      slug: "create-customer",
      label: "Create Customer",
      description: "Create a customer in the store",
      category: "Tiendanube",
      stepFunction: "createCustomerStep",
      stepImportPath: "create-customer",
      outputFields: [
        { field: "id", description: "Customer ID" },
        { field: "name", description: "Name" },
        { field: "email", description: "Email" },
      ],
      configFields: [
        {
          key: "name",
          label: "Name",
          type: "template-input",
          placeholder: "Juan Pérez",
          example: "Juan Pérez",
          required: true,
        },
        {
          key: "email",
          label: "Email",
          type: "template-input",
          placeholder: "cliente@email.com",
          example: "cliente@email.com",
          required: true,
        },
        {
          key: "phone",
          label: "Phone",
          type: "template-input",
          placeholder: "+54911...",
          example: "",
        },
        {
          key: "identification",
          label: "ID number (DNI/CUIT)",
          type: "template-input",
          placeholder: "30123456",
          example: "",
        },
        {
          key: "sendWelcomeEmail",
          label: "Send welcome email (1 = yes)",
          type: "template-input",
          placeholder: "0",
          example: "0",
        },
      ],
    },
  ],
};

registerIntegration(tiendanubePlugin);

export default tiendanubePlugin;
