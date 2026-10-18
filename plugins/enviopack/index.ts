import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { EnviopackIcon } from "./icon";

const field = (key: string, label: string, placeholder: string, required = false) => ({
  key,
  label,
  type: "template-input" as const,
  placeholder,
  example: placeholder,
  ...(required ? { required: true } : {}),
});

const enviopackPlugin: IntegrationPlugin = {
  type: "enviopack",
  label: "Envíopack",
  description: "Cotizá envíos con varios correos desde una sola cuenta",

  icon: EnviopackIcon,

  formFields: [
    {
      id: "apiKey",
      label: "API Key",
      type: "text",
      placeholder: "Tu API Key de Envíopack",
      configKey: "apiKey",
      envVar: "ENVIOPACK_API_KEY",
      helpText: "En tu cuenta de Envíopack: Credenciales de API.",
    },
    {
      id: "secretKey",
      label: "Secret Key",
      type: "password",
      placeholder: "Tu Secret Key de Envíopack",
      configKey: "secretKey",
      envVar: "ENVIOPACK_SECRET_KEY",
      helpText: "Está junto a la API Key en Credenciales de API.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testEnviopack } = await import("./test");
      return testEnviopack;
    },
  },

  actions: [
    {
      slug: "get-rates",
      label: "Get Shipping Rates",
      description: "Quote a shipment with every carrier enabled in your account",
      category: "Envíopack",
      stepFunction: "getRatesStep",
      stepImportPath: "get-rates",
      outputFields: [
        { field: "rates", description: "Quotes (carrier, mode, service, price, hours)" },
        { field: "cheapest", description: "Cheapest quote" },
        { field: "count", description: "Number of quotes" },
      ],
      configFields: [
        field("provinceId", "Destination province ID (e.g. C, B, X)", "B", true),
        field("postalCode", "Destination postal code (4 digits)", "1405", true),
        field("weightKg", "Weight (kg)", "1.5", true),
        field("packages", "Packages HxWxL cm, comma separated", "20x3x5"),
        field("carrierId", "Only this carrier ID (e.g. oca)", "oca"),
        field("deliveryMode", "Delivery mode (D home, S branch)", "D"),
      ],
    },
    {
  slug: "create-shipment",
  label: "Create Shipment",
  description: "Create the order and its shipment. Stays as draft unless confirmed = true",
  category: "Envíopack",
  stepFunction: "enviopackCreateShipment",
  stepImportPath: "create-shipment",
  outputFields: [
    { field: "orderId", description: "Created order (pedido) ID" },
    { field: "shipmentId", description: "Created shipment (envío) ID" },
    { field: "status", description: "Shipment status" },
  ],
  configFields: [
    field("externalId", "Your order ID", "ORDER-1001", true),
    field("firstName", "Buyer first name", "Juan", true),
    field("lastName", "Buyer last name", "Pérez", true),
    field("email", "Buyer email", "juan@mail.com", true),
    field("amount", "Order amount", "45000", true),
    field("recipientName", "Recipient full name", "Juan Pérez", true),
    field("deliveryMode", "Delivery mode (D home, S branch)", "D", true),
    field("weightKg", "Weight (kg)", "1.5", true),
    field("phone", "Buyer phone", "1134567890"),
    field("paid", "Order paid (true/false)", "true"),
    field("pickupAddressId", "Your deposit address ID (Configuración > Depósitos)", "123"),
    field("dispatchMode", "Dispatch mode (D home pickup, S branch drop-off)", "D"),
    field("service", "Service (N standard, P priority, X express, R round trip)", "N"),
    field("carrierId", "Carrier ID (from the quote)", "oca"),
    field("branchId", "Destination branch ID (mode S)", "456"),
    field("street", "Street (mode D)", "Av. Corrientes"),
    field("streetNumber", "Street number (mode D)", "1234"),
    field("floor", "Floor", "3"),
    field("apartment", "Apartment", "B"),
    field("postalCode", "Postal code (mode D)", "1405"),
    field("provinceId", "Province ID", "1"),
    field("cityId", "Locality ID", "5001"),
    field("packageHeightCm", "Package height (cm)", "20"),
    field("packageWidthCm", "Package width (cm)", "30"),
    field("packageLengthCm", "Package length (cm)", "40"),
    field("packageDescription", "Package description", "Ropa"),
    field("observations", "Observations", ""),
    field("confirmed", "Confirm now (true = real dispatch, false = draft)", "false"),
  ],
},
{
  slug: "get-shipment",
  label: "Get Shipment",
  description: "Get a shipment's details",
  category: "Envíopack",
  stepFunction: "enviopackGetShipment",
  stepImportPath: "get-shipment",
  outputFields: [{ field: "raw", description: "Full shipment data" }],
  configFields: [field("shipmentId", "Shipment ID", "123456", true)],
},
{
  slug: "get-tracking",
  label: "Get Tracking",
  description: "Get a shipment's tracking events",
  category: "Envíopack",
  stepFunction: "enviopackGetTracking",
  stepImportPath: "get-tracking",
  outputFields: [{ field: "raw", description: "Tracking events" }],
  configFields: [
    field("shipmentId", "Shipment ID", "123456", true),
    field("dateFormat", "Date format (iso)", "iso"),
    field("order", "Order (asc, desc)", "desc"),
  ],
},
{
  slug: "get-label",
  label: "Get Label",
  description: "Download a shipment's label (base64 PDF/JPG)",
  category: "Envíopack",
  stepFunction: "enviopackGetLabel",
  stepImportPath: "get-label",
  outputFields: [
    { field: "base64", description: "Label file in base64" },
    { field: "contentType", description: "File content type" },
  ],
  configFields: [
    field("shipmentId", "Shipment ID", "123456", true),
    field("format", "Format (pdf, jpg)", "pdf"),
    field("packageNumber", "Package number (multi-package)", "1"),
  ],
},
{
  slug: "list-branches",
  label: "List Branches",
  description: "List carrier branches (for branch delivery)",
  category: "Envíopack",
  stepFunction: "enviopackListBranches",
  stepImportPath: "list-branches",
  outputFields: [{ field: "raw", description: "Branches list" }],
  configFields: [
    field("carrierId", "Carrier ID (e.g. oca)", "oca"),
    field("localityId", "Locality ID", "5001"),
  ],
}
  ],
};

registerIntegration(enviopackPlugin);

export default enviopackPlugin;
