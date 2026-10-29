import type { IntegrationPlugin } from "../registry";
import { registerIntegration } from "../registry";
import { WhatsAppIcon } from "./icon";

const whatsappPlugin: IntegrationPlugin = {
  type: "whatsapp",
  label: "WhatsApp Business",
  description: "Enviá y recibí mensajes con la API oficial WhatsApp Business (Cloud API)",

  icon: WhatsAppIcon,

  formFields: [
    {
      id: "accessToken",
      label: "Access Token",
      type: "password",
      placeholder: "EAAG...",
      configKey: "accessToken",
      envVar: "WHATSAPP_ACCESS_TOKEN",
      helpText: "Token de un usuario del sistema (System User) de tu Meta Business, con acceso a la cuenta de WhatsApp. El token temporal de prueba vence en 24 horas.",
    },
    {
      id: "phoneNumberId",
      label: "Phone Number ID",
      type: "text",
      placeholder: "1234567890",
      configKey: "phoneNumberId",
      envVar: "WHATSAPP_PHONE_NUMBER_ID",
      helpText: "En developers.facebook.com, tu app, WhatsApp, Configuración de la API.",
    },
    {
      id: "businessAccountId",
      label: "Business Account ID (WABA)",
      type: "text",
      placeholder: "1234567890",
      configKey: "businessAccountId",
      envVar: "WHATSAPP_BUSINESS_ACCOUNT_ID",
      helpText: "Necesario para listar plantillas.",
    },
    {
      id: "appSecret",
      label: "App Secret",
      type: "password",
      placeholder: "Clave secreta de tu app de Meta",
      configKey: "appSecret",
      envVar: "WHATSAPP_APP_SECRET",
      helpText: "Necesaria para recibir mensajes: se usa para comprobar que los avisos vienen de Meta.",
    },
    {
      id: "verifyToken",
      label: "Verify Token",
      type: "password",
      placeholder: "Cualquier texto secreto que elijas",
      configKey: "verifyToken",
      envVar: "WHATSAPP_VERIFY_TOKEN",
      helpText: "Poné el mismo texto en Meta al configurar el webhook.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testWhatsApp } = await import("./test");
      return testWhatsApp;
    },
  },

  triggers: [
    {
      slug: "incoming-message",
      label: "Incoming Message",
      description: "A customer sent a message to your WhatsApp number.",
      category: "WhatsApp",
      configFields: [],
      outputFields: [
        { field: "messageId", description: "Message ID" },
        { field: "from", description: "Sender phone number" },
        { field: "contactName", description: "Sender profile name" },
        { field: "type", description: "text, image, button, interactive..." },
        { field: "text", description: "Message text (or caption / button title)" },
        { field: "replyId", description: "ID of the tapped button or list item" },
        { field: "mediaId", description: "Media ID, if any" },
        { field: "receivedAt", description: "When it was sent" },
      ],
    },
    {
      slug: "message-status-updated",
      label: "Message Status Updated",
      description: "A message you sent was sent, delivered, read or failed.",
      category: "WhatsApp",
      configFields: [],
      outputFields: [
        { field: "messageId", description: "Message ID" },
        { field: "status", description: "sent, delivered, read or failed" },
        { field: "recipient", description: "Recipient phone number" },
        { field: "errorCode", description: "Error code, if failed" },
        { field: "errorMessage", description: "Error message, if failed" },
      ],
    },
  ],

  webhook: {},

  actions: [
    {
      slug: "send-message",
      label: "Send Message",
      description: "Send a text message (only within 24 hours of the customer's last message)",
      category: "WhatsApp",
      stepFunction: "sendMessageStep",
      stepImportPath: "send-message",
      outputFields: [
        { field: "messageId", description: "ID of the sent message" },
        { field: "to", description: "Recipient" },
      ],
      configFields: [
        {
          key: "to",
          label: "To",
          type: "template-input",
          placeholder: "5491112345678 or {{Trigger.from}}",
          example: "5491112345678",
          required: true,
        },
        {
          key: "text",
          label: "Message",
          type: "template-textarea",
          placeholder: "Hola! Tu pedido está en camino.",
          example: "Hola!",
          required: true,
        },
      ],
    },
    {
      slug: "send-template",
      label: "Send Template",
      description: "Send a Meta-approved template (works outside the 24-hour window)",
      category: "WhatsApp",
      stepFunction: "sendTemplateStep",
      stepImportPath: "send-template",
      outputFields: [
        { field: "messageId", description: "ID of the sent message" },
        { field: "to", description: "Recipient" },
      ],
      configFields: [
        {
          key: "to",
          label: "To",
          type: "template-input",
          placeholder: "5491112345678 or {{Trigger.from}}",
          example: "5491112345678",
          required: true,
        },
        {
          key: "templateName",
          label: "Template name",
          type: "template-input",
          placeholder: "hello_world",
          example: "hello_world",
          required: true,
        },
        {
          key: "languageCode",
          label: "Language code",
          type: "template-input",
          placeholder: "es_AR",
          example: "es_AR",
        },
        {
          key: "bodyParameters",
          label: "Body parameters (one per line)",
          type: "template-textarea",
          placeholder: "Leo\n12345",
          example: "Leo",
        },
      ],
    },
    {
      slug: "list-templates",
      label: "List Templates",
      description: "List your message templates and their approval status",
      category: "WhatsApp",
      stepFunction: "listTemplatesStep",
      stepImportPath: "list-templates",
      outputFields: [
        { field: "templates", description: "Templates (name, language, status, category)" },
        { field: "count", description: "Templates returned" },
      ],
      configFields: [
      ],
    },
    {
      slug: "mark-as-read",
      label: "Mark as Read",
      description: "Mark an incoming message as read (blue ticks)",
      category: "WhatsApp",
      stepFunction: "markAsReadStep",
      stepImportPath: "mark-as-read",
      outputFields: [
        { field: "messageId", description: "Message ID" },
      ],
      configFields: [
        {
          key: "messageId",
          label: "Message ID",
          type: "template-input",
          placeholder: "{{Trigger.messageId}}",
          example: "wamid.XXX",
          required: true,
        },
      ],
    },
    {
      slug: "send-media",
      label: "Send Media",
      description: "Send an image, document, audio or video from a public URL (only within 24 hours of the customer's last message)",
      category: "WhatsApp",
      stepFunction: "sendMediaStep",
      stepImportPath: "send-media",
      outputFields: [
        { field: "messageId", description: "ID of the sent message" },
        { field: "to", description: "Recipient" },
      ],
      configFields: [
        {
          key: "to",
          label: "To",
          type: "template-input",
          placeholder: "5491112345678 or {{Trigger.from}}",
          example: "5491112345678",
          required: true,
        },
        {
          key: "mediaType",
          label: "Media type (image, document, audio, video)",
          type: "template-input",
          placeholder: "image",
          example: "image",
        },
        {
          key: "mediaUrl",
          label: "Media URL (public https)",
          type: "template-input",
          placeholder: "https://example.com/factura.pdf",
          example: "https://example.com/factura.pdf",
          required: true,
        },
        {
          key: "caption",
          label: "Caption",
          type: "template-input",
          placeholder: "Tu factura",
          example: "Tu factura",
        },
        {
          key: "filename",
          label: "Filename (documents)",
          type: "template-input",
          placeholder: "factura.pdf",
          example: "factura.pdf",
        },
      ],
    },
  ],
};

registerIntegration(whatsappPlugin);

export default whatsappPlugin;
