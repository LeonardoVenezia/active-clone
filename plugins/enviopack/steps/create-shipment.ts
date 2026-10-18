import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { enviopackGet, enviopackGetBytes, enviopackPost, hasEnviopackCredentials, NOT_CONFIGURED_ERROR } from "../api";
import type { EnviopackCredentials } from "../credentials";

// Two-phase flow per Envíopack API: create the order (pedido), then the shipment (envío).
// confirmed defaults to "false" so the shipment stays a draft unless explicitly confirmed.
type Result =
  | { success: true; orderId: number; shipmentId: number | null; status: string | null; raw: unknown }
  | { success: false; error: string };
type Input = StepInput & {
  externalId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  amount: string;
  paid?: string;
  recipientName: string;
  deliveryMode: string;
  weightKg: string;
  pickupAddressId?: string;
  dispatchMode?: string;
  service?: string;
  carrierId?: string;
  branchId?: string;
  street?: string;
  streetNumber?: string;
  floor?: string;
  apartment?: string;
  postalCode?: string;
  provinceId?: string;
  cityId?: string;
  packageHeightCm?: string;
  packageWidthCm?: string;
  packageLengthCm?: string;
  packageDescription?: string;
  observations?: string;
  confirmed?: string;
  integrationId?: string;
};

async function stepHandler(input: Input, credentials: EnviopackCredentials): Promise<Result> {
  if (!hasEnviopackCredentials(credentials)) {
    return { success: false, error: NOT_CONFIGURED_ERROR };
  }
  if (!input.externalId || !input.firstName || !input.lastName || !input.email || !input.amount ||
      !input.recipientName || !input.deliveryMode || !input.weightKg) {
    return { success: false, error: "externalId, buyer data, recipientName, deliveryMode and weightKg are required" };
  }
  const isBranch = input.deliveryMode === "S";
  if (isBranch && !input.branchId) {
    return { success: false, error: "Branch delivery (S) requires branchId" };
  }
  if (!isBranch && (!input.street || !input.streetNumber || !input.postalCode)) {
    return { success: false, error: "Home delivery (D) requires street, streetNumber and postalCode" };
  }
  try {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const order = (await enviopackPost(credentials, "/pedidos", {
      id_externo: input.externalId,
      nombre: input.firstName,
      apellido: input.lastName,
      email: input.email,
      telefono: input.phone || "",
      monto: Number(input.amount),
      fecha_alta: now,
      pagado: input.paid !== "false",
      ...(input.provinceId ? { provincia: Number(input.provinceId) } : {}),
      ...(input.cityId ? { localidad: Number(input.cityId) } : {}),
    })) as { id?: number };
    if (!order.id) return { success: false, error: "Envíopack did not return the order id" };

    const shipmentBody: Record<string, unknown> = {
      pedido: order.id,
      destinatario: input.recipientName,
      observaciones: input.observations || "",
      confirmado: input.confirmed === "true",
      paquetes: [
        {
          alto: Number(input.packageHeightCm || "10"),
          ancho: Number(input.packageWidthCm || "10"),
          largo: Number(input.packageLengthCm || "10"),
          peso: Number(input.weightKg),
          descripcion_primera_linea: input.packageDescription || "Paquete",
          descripcion_segunda_linea: "",
        },
      ],
      despacho: input.dispatchMode || "D",
      modalidad: input.deliveryMode,
    };
    if (input.pickupAddressId) shipmentBody.direccion_envio = Number(input.pickupAddressId);
    if (input.service) shipmentBody.servicio = input.service;
    if (input.carrierId) shipmentBody.correo = input.carrierId;
    if (isBranch) {
      shipmentBody.sucursal = Number(input.branchId);
    } else {
      shipmentBody.calle = input.street;
      shipmentBody.numero = input.streetNumber;
      shipmentBody.piso = input.floor || "";
      shipmentBody.depto = input.apartment || "";
      shipmentBody.codigo_postal = input.postalCode;
      if (input.provinceId) shipmentBody.provincia = Number(input.provinceId);
      if (input.cityId) shipmentBody.localidad = Number(input.cityId);
    }

    const shipment = (await enviopackPost(credentials, "/envios", shipmentBody)) as { id?: number; estado?: string };
    return { success: true, orderId: order.id, shipmentId: shipment.id ?? null, status: shipment.estado ?? null, raw: shipment };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function enviopackCreateShipment(input: Input): Promise<Result> {
  "use step";

  const credentials = input.integrationId ? await fetchCredentials(input.integrationId) : {};
  return withStepLogging(input, () => stepHandler(input, credentials));
}
enviopackCreateShipment.maxRetries = 0;

export const _integrationType = "enviopack";
