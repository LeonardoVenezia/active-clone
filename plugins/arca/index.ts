import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { ArcaIcon } from "./icon";

// Engine: open source `facturas` SDK behind ./engine.ts. Setup steps in ARCA
// are documented at the top of engine.ts.
const arcaPlugin: IntegrationPlugin = {
  type: "arca",
  label: "ARCA (ex AFIP)",
  description: "Consultá el padrón y emití facturas electrónicas directo con ARCA, con tu propio certificado",

  icon: ArcaIcon,

  formFields: [
    {
      id: "taxId",
      label: "CUIT",
      type: "text",
      placeholder: "20123456789",
      configKey: "taxId",
      envVar: "ARCA_TAX_ID",
      helpText: "CUIT del emisor, 11 dígitos.",
    },
    {
      id: "certificate",
      label: "Certificado (PEM)",
      type: "password",
      placeholder: "-----BEGIN CERTIFICATE-----...",
      configKey: "certificatePem",
      envVar: "ARCA_CERTIFICATE_PEM",
      helpText: "El certificado x509 que entrega ARCA (WSASS en homologación). Ver docs: facturas-sdk.dev/getting-started/arca-setup",
    },
    {
      id: "privateKey",
      label: "Clave privada (PEM)",
      type: "password",
      placeholder: "-----BEGIN PRIVATE KEY-----...",
      configKey: "privateKeyPem",
      envVar: "ARCA_PRIVATE_KEY_PEM",
      helpText: "La clave privada generada con el CSR (npx facturas init). Nunca la compartas.",
    },
    {
      id: "environment",
      label: "Entorno",
      type: "text",
      placeholder: "test",
      configKey: "environment",
      envVar: "ARCA_ENVIRONMENT",
      helpText: "test (homologación, por defecto) o production. Los certificados de cada entorno son distintos.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testArca } = await import("./test");
      return testArca;
    },
  },

  actions: [
    {
      slug: "lookup-taxpayer",
      label: "Lookup Taxpayer",
      description: "Look up a taxpayer in ARCA's padrón by CUIT (name, address, IVA condition to invoice with)",
      category: "ARCA",
      stepFunction: "lookupTaxpayerStep",
      stepImportPath: "lookup-taxpayer",
      outputFields: [
        { field: "found", description: "true if the CUIT exists" },
        { field: "name", description: "Name or business name" },
        { field: "personType", description: "Person type" },
        { field: "condition", description: "Receiver condition to invoice them under" },
        { field: "address", description: "Address" },
      ],
      configFields: [
        {
          key: "taxId",
          label: "CUIT",
          type: "template-input",
          placeholder: "20123456789 or {{Trigger.cuit}}",
          example: "20123456789",
          required: true,
        },
      ],
    },
    {
      slug: "issue-invoice",
      label: "Issue Invoice",
      description: "Issue an electronic invoice (one line) and get its CAE. Returns authorized, rejected, indeterminate or conflict",
      category: "ARCA",
      stepFunction: "issueInvoiceStep",
      stepImportPath: "issue-invoice",
      outputFields: [
        { field: "outcome", description: "authorized, rejected, indeterminate or conflict" },
        { field: "cae", description: "CAE (if authorized)" },
        { field: "caeExpiry", description: "CAE expiry" },
        { field: "voucherType", description: "Voucher type code" },
        { field: "number", description: "Voucher number" },
        { field: "salesPoint", description: "Sales point" },
        { field: "qr", description: "URL for the QR to print" },
        { field: "issues", description: "Rejection reasons (if rejected)" },
      ],
      configFields: [
        {
          key: "issuer",
          label: "Issuer",
          type: "select",
          options: [
            { value: "monotributo", label: "Monotributo" },
            { value: "responsable_inscripto", label: "Responsable Inscripto" },
          ],
          defaultValue: "monotributo",
        },
        {
          key: "salesPoint",
          label: "Sales point",
          type: "template-input",
          placeholder: "3",
          example: "3",
          required: true,
        },
        {
          key: "customerCondition",
          label: "Customer condition",
          type: "select",
          options: [
            { value: "consumidor_final", label: "Consumidor final" },
            { value: "responsable_inscripto", label: "Responsable Inscripto" },
            { value: "monotributo", label: "Monotributo" },
            { value: "exento", label: "Exento" },
          ],
          defaultValue: "consumidor_final",
        },
        {
          key: "customerTaxId",
          label: "Customer CUIT / DNI",
          type: "template-input",
          placeholder: "Required unless consumidor final",
          example: "20123456789",
        },
        {
          key: "amount",
          label: "Total (pesos)",
          type: "template-input",
          placeholder: "1500.00",
          example: "1500.00",
          required: true,
        },
        {
          key: "description",
          label: "Description",
          type: "template-input",
          placeholder: "Servicio de diseño",
          example: "Servicio de diseño",
        },
        {
          key: "idempotencyKey",
          label: "Idempotency key",
          type: "template-input",
          placeholder: "{{Trigger.orderId}}",
          example: "order-1234",
          required: true,
        },
      ],
    },
  ],
};

registerIntegration(arcaPlugin);

export default arcaPlugin;
