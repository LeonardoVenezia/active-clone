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
  ],
};

registerIntegration(zipnovaPlugin);

export default zipnovaPlugin;
