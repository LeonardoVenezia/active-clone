import type { IntegrationProvider } from "./core/provider";
import { composioProvider } from "./providers/composio";
// Custom providers (e.g. a MercadoPago provider) register their own toolkit ids here.
const CUSTOM: Record<string, IntegrationProvider> = {};
export function providerFor(toolkitId: string): IntegrationProvider { return CUSTOM[toolkitId] ?? composioProvider; }
export function catalogProvider(): IntegrationProvider { return composioProvider; }
