import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { CorreoArgentinoIcon } from "./icon";

const field = (key: string, label: string, placeholder: string, required = false) => ({
  key,
  label,
  type: "template-input" as const,
  placeholder,
  example: placeholder,
  ...(required ? { required: true } : {}),
});

const correoPlugin: IntegrationPlugin = {
  type: "correoargentino",
  label: "Correo Argentino",
  description: "Cotizar envíos y buscar sucursales con MiCorreo",

  icon: CorreoArgentinoIcon,

  formFields: [
    {
      id: "user",
      label: "API User",
      type: "text",
      placeholder: "Usuario de la API MiCorreo",
      configKey: "user",
      envVar: "CORREO_ARGENTINO_USER",
      helpText: "Credenciales de la API: las entrega Correo Argentino (una por ambiente).",
    },
    {
      id: "password",
      label: "API Password",
      type: "password",
      placeholder: "Contraseña de la API MiCorreo",
      configKey: "password",
      envVar: "CORREO_ARGENTINO_PASSWORD",
    },
    {
      id: "customerId",
      label: "Customer ID",
      type: "text",
      placeholder: "0090000025",
      configKey: "customerId",
      envVar: "CORREO_ARGENTINO_CUSTOMER_ID",
      helpText: "El ID de cliente MiCorreo (se obtiene al registrar o validar tu usuario en MiCorreo).",
    },
    {
      id: "environment",
      label: "Environment",
      type: "text",
      placeholder: "test",
      configKey: "environment",
      envVar: "CORREO_ARGENTINO_ENVIRONMENT",
      helpText: "Dejalo vacío para usar el ambiente de pruebas. Escribí production solo para el real.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testCorreoArgentino } = await import("./test");
      return testCorreoArgentino;
    },
  },

  actions: [
    {
      slug: "get-rates",
      label: "Get Shipping Rates",
      description: "Quote a shipment to a home address or a branch",
      category: "Correo Argentino",
      stepFunction: "getRatesStep",
      stepImportPath: "get-rates",
      outputFields: [
        { field: "rates", description: "Rates (type, product, price)" },
        { field: "cheapestPrice", description: "Lowest price" },
        { field: "validTo", description: "Quote valid until" },
      ],
      configFields: [
        field("postalCodeOrigin", "Origin postal code", "1757", true),
        field("postalCodeDestination", "Destination postal code", "1704", true),
        field("weightGrams", "Weight (grams)", "2500", true),
        field("heightCm", "Height (cm)", "10", true),
        field("widthCm", "Width (cm)", "20", true),
        field("lengthCm", "Length (cm)", "30", true),
        field("deliveredType", "Delivery type (D home, S branch; empty = both)", "D"),
      ],
    },
    {
      slug: "list-agencies",
      label: "List Branches",
      description: "List Correo Argentino branches in a province",
      category: "Correo Argentino",
      stepFunction: "listAgenciesStep",
      stepImportPath: "list-agencies",
      outputFields: [
        { field: "count", description: "Number of branches" },
        { field: "agencies", description: "Branches" },
      ],
      configFields: [field("provinceCode", "Province code", "B", true)],
    },
  ],
};

registerIntegration(correoPlugin);

export default correoPlugin;
