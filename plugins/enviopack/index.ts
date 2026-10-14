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
  ],
};

registerIntegration(enviopackPlugin);

export default enviopackPlugin;
