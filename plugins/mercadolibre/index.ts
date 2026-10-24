import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { MercadoLibreIcon } from "./icon";

const mercadolibrePlugin: IntegrationPlugin = {
  type: "mercadolibre",
  label: "Mercado Libre",
  description: "Ventas, preguntas y publicaciones de tu cuenta de Mercado Libre",

  icon: MercadoLibreIcon,

  formFields: [
    {
      id: "userId",
      label: "User ID",
      type: "text",
      placeholder: "123456789",
      configKey: "userId",
      envVar: "MERCADOLIBRE_USER_ID",
      helpText:
        "Se completa solo al conectar tu cuenta desde Mercado Libre. Es el user_id del vendedor.",
    },
    {
      id: "accessToken",
      label: "Access Token",
      type: "password",
      placeholder: "APP_USR-...",
      configKey: "accessToken",
      envVar: "MERCADOLIBRE_ACCESS_TOKEN",
      helpText: "Dura 6 horas; se renueva solo con el Refresh Token. Ver ",
      helpLink: {
        text: "developers.mercadolibre.com.ar",
        url: "https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion",
      },
    },
    {
      id: "refreshToken",
      label: "Refresh Token",
      type: "password",
      placeholder: "TG-...",
      configKey: "refreshToken",
      envVar: "MERCADOLIBRE_REFRESH_TOKEN",
      helpText: "Permite renovar el Access Token sin volver a iniciar sesión.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testMercadoLibre } = await import("./test");
      return testMercadoLibre;
    },
  },

  triggers: [
    {
      slug: "order-updated",
      label: "Order Created or Updated",
      description: "A sale was created or changed (topic orders_v2).",
      category: "Mercado Libre",
      configFields: [],
      outputFields: [
        { field: "orderId", description: "Order ID (use Get Order to read it)" },
        { field: "userId", description: "Seller user ID" },
      ],
    },
    {
      slug: "question-received",
      label: "Question Received",
      description: "A buyer asked or a question changed (topic questions).",
      category: "Mercado Libre",
      configFields: [],
      outputFields: [
        { field: "questionId", description: "Question ID (use Get Question to read it)" },
        { field: "userId", description: "Seller user ID" },
      ],
    },
  ],

  webhook: {
    getHandler: async () => {
      const { mercadolibreWebhook } = await import("./webhook");
      return mercadolibreWebhook;
    },
  },

  actions: [
    {
      slug: "get-order",
      label: "Get Order",
      description: "Get a sale by its ID",
      category: "Mercado Libre",
      stepFunction: "getOrderStep",
      stepImportPath: "get-order",
      outputFields: [
        { field: "id", description: "Order ID" },
        { field: "status", description: "Order status" },
        { field: "total", description: "Total amount" },
        { field: "currency", description: "Currency" },
        { field: "buyerNickname", description: "Buyer nickname" },
        { field: "items", description: "Items sold" },
        { field: "shippingId", description: "Shipment ID" },
      ],
      configFields: [
        {
          key: "orderId",
          label: "Order ID",
          type: "template-input",
          placeholder: "2000003508419013 or {{Trigger.orderId}}",
          example: "2000003508419013",
          required: true,
        },
      ],
    },
    {
      slug: "search-orders",
      label: "Search Orders",
      description: "List recent sales, optionally by text or status. Returns SUMMARY fields only (id, status, total, currency, buyerNickname, dateCreated). To read the FULL detail of one order (items, shipping id, buyer, etc.) follow with a Get Order step using the order id.",
      category: "Mercado Libre",
      stepFunction: "searchOrdersStep",
      stepImportPath: "search-orders",
      outputFields: [
        { field: "orders", description: "List of orders (id, status, total, currency, buyerNickname, dateCreated)" },
        { field: "count", description: "Orders returned" },
        { field: "total", description: "Total matches" },
      ],
      configFields: [
        {
          key: "query",
          label: "Search",
          type: "template-input",
          placeholder: "Order ID, item title or buyer",
          example: "",
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "any", label: "Any" },
            { value: "paid", label: "Paid" },
            { value: "confirmed", label: "Confirmed" },
            { value: "payment_required", label: "Payment required" },
            { value: "cancelled", label: "Cancelled" },
          ],
          defaultValue: "any",
        },
        {
          key: "limit",
          label: "Max results",
          type: "template-input",
          placeholder: "20",
          example: "20",
        },
      ],
    },
    {
      slug: "get-question",
      label: "Get Question",
      description: "Read a buyer question",
      category: "Mercado Libre",
      stepFunction: "getQuestionStep",
      stepImportPath: "get-question",
      outputFields: [
        { field: "id", description: "Question ID" },
        { field: "itemId", description: "Item ID" },
        { field: "text", description: "Question text" },
        { field: "status", description: "UNANSWERED or ANSWERED" },
        { field: "answer", description: "Answer text, if any" },
      ],
      configFields: [
        {
          key: "questionId",
          label: "Question ID",
          type: "template-input",
          placeholder: "{{Trigger.questionId}}",
          example: "11751825075",
          required: true,
        },
      ],
    },
    {
      slug: "answer-question",
      label: "Answer Question",
      description: "Answer a buyer question",
      category: "Mercado Libre",
      stepFunction: "answerQuestionStep",
      stepImportPath: "answer-question",
      outputFields: [
        { field: "questionId", description: "Question ID" },
      ],
      configFields: [
        {
          key: "questionId",
          label: "Question ID",
          type: "template-input",
          placeholder: "{{Trigger.questionId}}",
          example: "11751825075",
          required: true,
        },
        {
          key: "text",
          label: "Answer",
          type: "template-textarea",
          placeholder: "Hola! Sí, tenemos stock.",
          example: "Hola! Sí, tenemos stock.",
          required: true,
        },
      ],
    },
    {
      slug: "list-items",
      label: "List Items",
      description: "List the seller's items with stock and price",
      category: "Mercado Libre",
      stepFunction: "listItemsStep",
      stepImportPath: "list-items",
      outputFields: [
        { field: "items", description: "List of items (id, title, availableQuantity, price, status)" },
        { field: "count", description: "Items returned" },
      ],
      configFields: [
        {
          key: "query",
          label: "Search",
          type: "template-input",
          placeholder: "Item title",
          example: "zapatillas",
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "any", label: "Any" },
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "closed", label: "Closed" },
          ],
          defaultValue: "any",
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
      slug: "get-item",
      label: "Get Listing",
      description: "Get a listing (price, stock, status)",
      category: "Mercado Libre",
      stepFunction: "getItemStep",
      stepImportPath: "get-item",
      outputFields: [
        { field: "id", description: "Item ID" },
        { field: "title", description: "Title" },
        { field: "description", description: "Listing description as plain text (empty when the listing has none)" },
        { field: "price", description: "Price" },
        { field: "currency", description: "Currency" },
        { field: "availableQuantity", description: "Available stock" },
        { field: "soldQuantity", description: "Units sold" },
        { field: "status", description: "active, paused or closed" },
        { field: "permalink", description: "Public link" },
      ],
      configFields: [
        {
          key: "itemId",
          label: "Item ID",
          type: "template-input",
          placeholder: "MLA123456789",
          example: "MLA123456789",
          required: true,
        },
      ],
    },
    {
      slug: "update-item",
      label: "Update Listing",
      description: "Change price, stock or pause/reactivate a listing",
      category: "Mercado Libre",
      stepFunction: "updateItemStep",
      stepImportPath: "update-item",
      outputFields: [
        { field: "id", description: "Item ID" },
        { field: "price", description: "Price" },
        { field: "availableQuantity", description: "Available stock" },
        { field: "status", description: "Status" },
      ],
      configFields: [
        {
          key: "itemId",
          label: "Item ID",
          type: "template-input",
          placeholder: "MLA123456789",
          example: "MLA123456789",
          required: true,
        },
        {
          key: "price",
          label: "New price",
          type: "template-input",
          placeholder: "Leave empty to keep",
          example: "15000",
        },
        {
          key: "availableQuantity",
          label: "New stock",
          type: "template-input",
          placeholder: "Leave empty to keep",
          example: "10",
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "keep", label: "Keep as is" },
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
          ],
          defaultValue: "keep",
        },

      ],
    },
    {
      slug: "get-shipment",
      label: "Get Shipment",
      description: "Get a shipment's status and tracking by its ID",
      category: "Mercado Libre",
      stepFunction: "getShipmentStep",
      stepImportPath: "get-shipment",
      outputFields: [
        { field: "id", description: "Shipment ID" },
        { field: "status", description: "Shipment status" },
        { field: "substatus", description: "Shipment substatus" },
        { field: "trackingNumber", description: "Tracking number" },
        { field: "trackingMethod", description: "Carrier / shipping method" },
        { field: "serviceId", description: "Shipping service ID" },
        { field: "estimatedDelivery", description: "Estimated delivery date" },
        { field: "receiverCity", description: "Destination city" },
        { field: "shipment", description: "Full shipment object" },
      ],
      configFields: [
        {
          key: "shipmentId",
          label: "Shipment ID",
          type: "template-input",
          placeholder: "44493123511 or {{Get Order.shippingId}}",
          example: "44493123511",
          required: true,
        },
      ],
    },
    {
      slug: "get-label",
      label: "Get Shipping Label",
      description: "Get the shipping label (ZPL for thermal printers)",
      category: "Mercado Libre",
      stepFunction: "getShipmentLabelStep",
      stepImportPath: "get-label",
      outputFields: [
        { field: "shipmentId", description: "Shipment ID" },
        { field: "format", description: "Label format (zpl2)" },
        { field: "zpl", description: "Label ZPL code" },
      ],
      configFields: [
        {
          key: "shipmentId",
          label: "Shipment ID",
          type: "template-input",
          placeholder: "44493123511 or {{Get Order.shippingId}}",
          example: "44493123511",
          required: true,
        },
      ],
    },
    {
      slug: "send-message",
      label: "Send Post-Sale Message",
      description: "Message the buyer of an order (post-sale messaging)",
      category: "Mercado Libre",
      stepFunction: "sendMessageStep",
      stepImportPath: "send-message",
      outputFields: [
        { field: "orderId", description: "Order ID" },
        { field: "packId", description: "Pack ID used" },
        { field: "messageId", description: "Sent message ID" },
      ],
      configFields: [
        {
          key: "orderId",
          label: "Order ID",
          type: "template-input",
          placeholder: "2000003508419013 or {{Trigger.orderId}}",
          example: "2000003508419013",
          required: true,
        },
        {
          key: "text",
          label: "Message",
          type: "template-input",
          placeholder: "Tu pedido ya está en camino...",
          example: "Tu pedido ya está en camino.",
          required: true,
        },
      ],
    },
  ],
};

registerIntegration(mercadolibrePlugin);

export default mercadolibrePlugin;
