import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { ZipnovaIcon } from "./icon";

const field = (key: string, label: string, placeholder: string, required = false) => ({
  key,
  label,
  type: "template-input" as const,
  placeholder,
  example: placeholder,
  ...(required ? { required: true } : {}),
});

const zipnovaPlugin: IntegrationPlugin = {
  type: "zipnova",
  label: "Zipnova",
  description: "Cotizá envíos con los transportes de tu cuenta Zipnova",

  icon: ZipnovaIcon,

  formFields: [
    {
      id: "apiToken",
      label: "API Token",
      type: "text",
      placeholder: "API Token de Zipnova",
      configKey: "apiToken",
      envVar: "ZIPNOVA_API_TOKEN",
      helpText: "En Zipnova: Configuración > Integraciones > Gestionar credenciales y webhooks.",
    },
    {
      id: "apiSecret",
      label: "API Secret",
      type: "password",
      placeholder: "API Secret de Zipnova",
      configKey: "apiSecret",
      envVar: "ZIPNOVA_API_SECRET",
      helpText: "Se genera junto con el API Token.",
    },
    {
      id: "accountId",
      label: "Account ID",
      type: "text",
      placeholder: "1234",
      configKey: "accountId",
      envVar: "ZIPNOVA_ACCOUNT_ID",
      helpText: "El ID numérico de tu cuenta de Zipnova Envíos.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testZipnova } = await import("./test");
      return testZipnova;
    },
  },

  actions: [
    {
      slug: "get-rates",
      label: "Get Shipping Rates",
      description: "Quote a shipment with the carriers available in your account",
      category: "Zipnova",
      stepFunction: "getRatesStep",
      stepImportPath: "get-rates",
      outputFields: [
        { field: "options", description: "Options (carrier, service, price, delivery days)" },
        { field: "cheapest", description: "Cheapest option" },
        { field: "count", description: "Number of options" },
      ],
      configFields: [
        field("city", "Destination city", "Rosario", true),
        field("state", "Destination state", "Santa Fe", true),
        field("zipcode", "Destination zip code", "2000", true),
        field("declaredValue", "Declared value (ARS)", "45000", true),
        field("weightGrams", "Weight (grams)", "1200", true),
        field("heightCm", "Height (cm)", "30", true),
        field("widthCm", "Width (cm)", "20", true),
        field("lengthCm", "Length (cm)", "40", true),
        field("sortBy", "Sort by (price, rating, time)", "price"),
      ],
    },
    {
  slug: "create-shipment",
  label: "Create Shipment",
  description: "Create a shipment (home delivery or pickup point). Stays pending unless processImmediately = 1",
  category: "Zipnova",
  stepFunction: "zipnovaCreateShipment",
  stepImportPath: "create-shipment",
  outputFields: [
    { field: "shipmentId", description: "Created shipment ID" },
    { field: "status", description: "Shipment status" },
    { field: "raw", description: "Full API response" },
  ],
  configFields: [
    field("externalId", "Your order ID", "ORDER-1001", true),
    field("serviceType", "Service type (from the quote, e.g. pickup_point)", "pickup_point", true),
    field("declaredValue", "Declared value (ARS)", "45000", true),
    field("recipientName", "Recipient full name", "Juan Pérez", true),
    field("recipientDocument", "Recipient document", "30123456", true),
    field("recipientEmail", "Recipient email", "juan@mail.com", true),
    field("recipientPhone", "Recipient phone", "1134567890", true),
    field("weightGrams", "Weight (grams)", "1200", true),
    field("originId", "Origin ID ('auto' uses account default)", "auto"),
    field("logisticType", "Logistic type (ship_drop, fulfill_drop)", "ship_drop"),
    field("carrierId", "Carrier ID (from the quote; empty = auto)", "5"),
    field("sortBy", "Sort by when auto-picking carrier (price, rating, time)", "price"),
    field("processImmediately", "Dispatch immediately (1 = yes, 0 = pending)", "0"),
    field("pointId", "Pickup point ID (for pickup_point service)", ""),
    field("street", "Street (home delivery)", "Av. Corrientes"),
    field("streetNumber", "Street number", "1234"),
    field("streetExtras", "Floor / apartment", "3B"),
    field("city", "City", "Rosario"),
    field("state", "State / province", "Santa Fe"),
    field("zipcode", "Zip code", "2000"),
    field("packageHeightCm", "Package height (cm)", "30"),
    field("packageWidthCm", "Package width (cm)", "20"),
    field("packageLengthCm", "Package length (cm)", "40"),
    field("packageDescription", "Package description", "Ropa"),
  ],
},
{
  slug: "get-shipment",
  label: "Get Shipment",
  description: "Get a shipment's details. Needs a shipmentId, which is NOT the store order id: map an order to its shipment first (list-shipments with externalId=<orderId>, or the shipping id from the store plugin's get-order detail).",
  category: "Zipnova",
  stepFunction: "zipnovaGetShipment",
  stepImportPath: "get-shipment",
  outputFields: [{ field: "raw", description: "Full shipment data" }],
  configFields: [field("shipmentId", "Shipment ID", "123456", true)],
},
{
  slug: "list-shipments",
  label: "List Shipments",
  description: "List shipments with optional filters",
  category: "Zipnova",
  stepFunction: "zipnovaListShipments",
  stepImportPath: "list-shipments",
  outputFields: [{ field: "raw", description: "Shipments list" }],
  configFields: [
    field("externalId", "Filter by your order ID", "ORDER-1001"),
    field("status", "Filter by status", "pending"),
    field("carrierId", "Filter by carrier ID", "5"),
    field("serviceType", "Filter by service type", "pickup_point"),
  ],
},
{
  slug: "get-tracking",
  label: "Get Tracking",
  description: "Get a shipment's tracking events",
  category: "Zipnova",
  stepFunction: "zipnovaGetTracking",
  stepImportPath: "get-tracking",
  outputFields: [{ field: "raw", description: "Tracking events" }],
  configFields: [
    field("shipmentId", "Shipment ID", "123456", true),
    field("sort", "Sort (asc, desc)", "desc"),
  ],
},
{
  slug: "get-label",
  label: "Get Label",
  description: "Download a shipment's label or document (base64 PDF/ZPL)",
  category: "Zipnova",
  stepFunction: "zipnovaGetLabel",
  stepImportPath: "get-label",
  outputFields: [
    { field: "format", description: "Returned format" },
    { field: "raw", description: "Base64 document response" },
  ],
  configFields: [
    field("shipmentId", "Shipment ID", "123456", true),
    field("what", "Document type (label, document)", "label"),
    field("format", "Format (pdf, zpl)", "pdf"),
    field("noStatusChange", "Don't change shipment status (1 = yes)", "1"),
  ],
},
{
  slug: "cancel-shipment",
  label: "Cancel Shipment",
  description: "Cancel a shipment that was not dispatched yet",
  category: "Zipnova",
  stepFunction: "zipnovaCancelShipment",
  stepImportPath: "cancel-shipment",
  outputFields: [{ field: "raw", description: "Cancellation result (canceled or rescue_requested)" }],
  configFields: [field("shipmentId", "Shipment ID", "123456", true)],
}
  ],
};

registerIntegration(zipnovaPlugin);

export default zipnovaPlugin;
