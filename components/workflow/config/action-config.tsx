"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { HelpCircle, Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfigureConnectionOverlay } from "@/components/overlays/add-connection-overlay";
import { AiGatewayConsentOverlay } from "@/components/overlays/ai-gateway-consent-overlay";
import { useOverlay } from "@/components/overlays/overlay-provider";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { IntegrationIcon } from "@/components/ui/integration-icon";
import { IntegrationSelector } from "@/components/ui/integration-selector";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TemplateBadgeInput } from "@/components/ui/template-badge-input";
import { TemplateBadgeTextarea } from "@/components/ui/template-badge-textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseTogether, sameValueText, serializeTogether, TOGETHER_LABEL, TOGETHER_MAX, type TogetherRow, validateTogether, valueKindHint } from "@/lib/datos/together-config";
import { aiGatewayStatusAtom } from "@/lib/ai-gateway/state";
import {
  integrationsAtom,
  integrationsVersionAtom,
} from "@/lib/integrations-store";
import type { IntegrationType } from "@/lib/types/integration";
import {
  findActionById,
  getActionsByCategory,
  getAllIntegrations,
} from "@/plugins";
import { ActionConfigRenderer } from "./action-config-renderer";
import { SchemaBuilder, type SchemaField } from "./schema-builder";

type ActionConfigProps = {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
  isOwner?: boolean;
};

// Database Query fields component
function DatabaseQueryFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="dbQuery">SQL Query</Label>
        <div className="overflow-hidden rounded-md border">
          <CodeEditor
            defaultLanguage="sql"
            height="150px"
            onChange={(value) => onUpdateConfig("dbQuery", value || "")}
            options={{
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 12,
              readOnly: disabled,
              wordWrap: "off",
            }}
            value={(config?.dbQuery as string) || ""}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          The DATABASE_URL from your project integrations will be used to
          execute this query.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Schema (Optional)</Label>
        <SchemaBuilder
          disabled={disabled}
          onChange={(schema) =>
            onUpdateConfig("dbSchema", JSON.stringify(schema))
          }
          schema={
            config?.dbSchema
              ? (JSON.parse(config.dbSchema as string) as SchemaField[])
              : []
          }
        />
      </div>
    </>
  );
}

// HTTP Request fields component
function HttpRequestFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="httpMethod">Método HTTP</Label>
        <Select
          disabled={disabled}
          onValueChange={(value) => onUpdateConfig("httpMethod", value)}
          value={(config?.httpMethod as string) || "POST"}
        >
          <SelectTrigger className="w-full" id="httpMethod">
            <SelectValue placeholder="Elegí un método" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
            <SelectItem value="PATCH">PATCH</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="endpoint">URL</Label>
        <TemplateBadgeInput
          disabled={disabled}
          id="endpoint"
          onChange={(value) => onUpdateConfig("endpoint", value)}
          placeholder="https://api.example.com/endpoint or {{NodeName.url}}"
          value={(config?.endpoint as string) || ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="httpHeaders">Headers (JSON)</Label>
        <div className="overflow-hidden rounded-md border">
          <CodeEditor
            defaultLanguage="json"
            height="100px"
            onChange={(value) => onUpdateConfig("httpHeaders", value || "{}")}
            options={{
              minimap: { enabled: false },
              lineNumbers: "off",
              scrollBeyondLastLine: false,
              fontSize: 12,
              readOnly: disabled,
              wordWrap: "off",
            }}
            value={(config?.httpHeaders as string) || "{}"}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="httpBody">Body (JSON)</Label>
        <div
          className={`overflow-hidden rounded-md border ${config?.httpMethod === "GET" ? "opacity-50" : ""}`}
        >
          <CodeEditor
            defaultLanguage="json"
            height="120px"
            onChange={(value) => onUpdateConfig("httpBody", value || "{}")}
            options={{
              minimap: { enabled: false },
              lineNumbers: "off",
              scrollBeyondLastLine: false,
              fontSize: 12,
              readOnly: config?.httpMethod === "GET" || disabled,
              domReadOnly: config?.httpMethod === "GET" || disabled,
              wordWrap: "off",
            }}
            value={(config?.httpBody as string) || "{}"}
          />
        </div>
        {config?.httpMethod === "GET" && (
          <p className="text-muted-foreground text-xs">
            Body is disabled for GET requests
          </p>
        )}
      </div>
    </>
  );
}

// Condition fields component
function ConditionFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="condition">Expresión de condición</Label>
      <TemplateBadgeInput
        disabled={disabled}
        id="condition"
        onChange={(value) => onUpdateConfig("condition", value)}
        placeholder="e.g., 5 > 3, status === 200, {{PreviousNode.value}} > 100"
        value={(config?.condition as string) || ""}
      />
      <p className="text-muted-foreground text-xs">
        Enter a JavaScript expression that evaluates to true or false. You can
        use @ to reference previous node outputs.
      </p>
    </div>
  );
}

// Fórmula fields component
function FormulaFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="formula-input">Entrada (JSON)</Label>
        <TemplateBadgeInput
          disabled={disabled}
          id="formula-input"
          onChange={(value) => onUpdateConfig("input", value)}
          placeholder='{"precio": 100, "items": [1, 2, 3]}'
          value={(config?.input as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          JSON de entrada para la expresión. Usá @ para referenciar salidas de
          nodos anteriores.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="formula-expression">Expresión (JSONata)</Label>
        <div className="overflow-hidden rounded-md border">
          <CodeEditor
            defaultLanguage="plaintext"
            height="120px"
            onChange={(value) => onUpdateConfig("expression", value || "")}
            options={{
              minimap: { enabled: false },
              lineNumbers: "off",
              scrollBeyondLastLine: false,
              fontSize: 12,
              readOnly: disabled,
              wordWrap: "on",
            }}
            value={(config?.expression as string) || ""}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Expresión JSONata sobre la entrada. Ej: precio * 1.21,
          $uppercase(nombre), items[precio &gt; 100]. Sin red, sin acceso a
          credenciales, con límite de tiempo y tamaño.
        </p>
      </div>
    </div>
  );
}


// Delay fields component
// Frontend fields component (one basic page per workflow; prototype)
function FrontendFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="frontend-title">Título de la página</Label>
        <Input
          disabled={disabled}
          id="frontend-title"
          maxLength={80}
          onChange={(e) => onUpdateConfig("title", e.target.value)}
          placeholder="Panel"
          value={(config?.title as string) || ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="frontend-collection">Colección de Datos a mostrar</Label>
        <Input
          disabled={disabled}
          id="frontend-collection"
          onChange={(e) => onUpdateConfig("collection", e.target.value)}
          placeholder="productos"
          value={(config?.collection as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          Minúsculas, números y _. La página muestra los últimos datos de esa
          colección y se actualiza cada pocos segundos.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="frontend-columns">Columnas de la tabla (opcional)</Label>
        <Input
          disabled={disabled}
          id="frontend-columns"
          onChange={(e) => onUpdateConfig("columns", e.target.value)}
          placeholder="nombre, precio, stock"
          value={(config?.columns as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          Campos del valor que se muestran como columnas (hasta 12). Vacío: tabla básica Clave / Valor.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="frontend-form">Formulario</Label>
        <select
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          disabled={disabled}
          id="frontend-form"
          onChange={(e) => onUpdateConfig("showForm", e.target.value)}
          value={config?.showForm === "true" ? "true" : "false"}
        >
          <option value="false">Ocultar</option>
          <option value="true">Mostrar</option>
        </select>
        <p className="text-muted-foreground text-xs">
          Se arma con los campos que definas para la colección en un nodo Datos (Definir campos).
          Cada envío se valida en el servidor y se guarda en la colección.
        </p>
      </div>
      {config?.showForm === "true" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="frontend-keyfield">Campo que se usa como clave (opcional)</Label>
            <Input
              disabled={disabled}
              id="frontend-keyfield"
              onChange={(e) => onUpdateConfig("keyField", e.target.value)}
              placeholder="sku"
              value={(config?.keyField as string) || ""}
            />
            <p className="text-muted-foreground text-xs">Vacío: clave automática. Con clave, enviar de nuevo el mismo valor actualiza ese registro.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="frontend-runsubmit">Al enviar, ejecutar este workflow</Label>
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              disabled={disabled}
              id="frontend-runsubmit"
              onChange={(e) => onUpdateConfig("runOnSubmit", e.target.value)}
              value={config?.runOnSubmit === "true" ? "true" : "false"}
            >
              <option value="false">No</option>
              <option value="true">Sí, con los valores del formulario</option>
            </select>
            <p className="text-muted-foreground text-xs">
              Los valores validados llegan al disparador Manual (si ese disparador declara campos, recibe solo esos).
            </p>
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor="frontend-run">Botón Ejecutar</Label>
        <select
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          disabled={disabled}
          id="frontend-run"
          onChange={(e) => onUpdateConfig("showRun", e.target.value)}
          value={config?.showRun === "false" ? "false" : "true"}
        >
          <option value="true">Mostrar</option>
          <option value="false">Ocultar</option>
        </select>
        <p className="text-muted-foreground text-xs">
          La página es /frontend/(id de este workflow). Solo entra quien tiene
          acceso al workflow y a la empresa.
        </p>
      </div>
    </div>
  );
}

// Datos "Aplicar cambios juntos": editable list of changes (stored as a JSON string in config.operations).
function DatosTogetherEditor({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const [collapsed, setCollapsed] = useState<number[]>([]);
  // Text the user is typing: kept as typed (no reformatting) while it still means the same as what is stored.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rows = parseTogether(value);
  if (rows === null)
    return (
      <div className="space-y-2">
        <Label htmlFor="datos-operations-raw">Lista de cambios (JSON)</Label>
        <textarea className="min-h-32 w-full rounded-md border bg-background p-2 font-mono text-xs" disabled={disabled} id="datos-operations-raw" onChange={(e) => onChange(e.target.value)} value={value} />
        <p className="text-foreground/80 text-sm">No se pudo leer la lista como cambios editables. Corregí el JSON o borrá el contenido para armarla con el editor.</p>
      </div>
    );
  const set = (i: number, patch: Partial<TogetherRow>) => onChange(serializeTogether(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const setText = (i: number, k: "value" | "expected", text: string) => { setDrafts((d) => ({ ...d, [`${i}:${k}`]: text })); set(i, { [k]: text }); };
  const shown = (i: number, k: "value" | "expected", stored: string | undefined) => { const d = drafts[`${i}:${k}`]; return d !== undefined && sameValueText(d, stored ?? "") ? d : (stored ?? ""); };
  const check = validateTogether(rows);
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">Los cambios se aplican todos juntos o ninguno. Si uno no se cumple, no se guarda nada y el resultado dice estado = rechazado y cuál cambio falló. Si el paso se reintenta, devuelve el mismo resultado (repetido = verdadero). Hasta {TOGETHER_MAX} cambios; cada colección y clave solo una vez.</p>
      {rows.map((r, i) => (
        <div className="space-y-2 rounded-md border p-3" key={i}>
          <div className="flex items-center justify-between gap-2">
            <button className="min-w-0 flex-1 break-words text-left text-sm font-medium" onClick={() => setCollapsed((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))} type="button">
              {collapsed.includes(i) ? "▸" : "▾"} Cambio {i + 1}: {TOGETHER_LABEL[r.operation] ?? r.operation}
              {r.collection || r.key ? ` · ${r.collection}${r.key ? ` / ${r.key}` : ""}` : ""}
            </button>
            <Button disabled={disabled} onClick={() => { setCollapsed([]); setDrafts({}); onChange(serializeTogether(rows.filter((_, j) => j !== i))); }} size="sm" type="button" variant="ghost">Quitar</Button>
          </div>
          {check.errors[i].length > 0 && (
            <ul className="space-y-1 text-destructive text-xs" role="alert">
              {check.errors[i].map((m) => (<li key={m}>{m}</li>))}
            </ul>
          )}
          {!collapsed.includes(i) && (
          <>
          <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" disabled={disabled} id={`datos-t-${i}-op`} onChange={(e) => set(i, { operation: e.target.value })} value={r.operation}>
            {Object.entries(TOGETHER_LABEL).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
          </select>
          <Label htmlFor={`datos-t-${i}-col`}>Colección</Label>
          <Input disabled={disabled} id={`datos-t-${i}-col`} onChange={(e) => set(i, { collection: e.target.value })} placeholder="productos" value={r.collection} />
          <Label htmlFor={`datos-t-${i}-key`}>Clave</Label>
          <Input disabled={disabled} id={`datos-t-${i}-key`} onChange={(e) => set(i, { key: e.target.value })} placeholder="SKU-123" value={r.key} />
          {r.operation === "add" && (
            <>
              <Label htmlFor={`datos-t-${i}-field`}>Campo numérico</Label>
              <Input disabled={disabled} id={`datos-t-${i}-field`} onChange={(e) => set(i, { field: e.target.value })} placeholder="stock" value={r.field ?? ""} />
              <Label htmlFor={`datos-t-${i}-amount`}>Cantidad a sumar (negativa para restar)</Label>
              <Input disabled={disabled} id={`datos-t-${i}-amount`} onChange={(e) => set(i, { amount: e.target.value })} placeholder="-1" value={r.amount ?? ""} />
              <Label htmlFor={`datos-t-${i}-min`}>Mínimo permitido (opcional)</Label>
              <Input disabled={disabled} id={`datos-t-${i}-min`} onChange={(e) => set(i, { min: e.target.value })} placeholder="0" value={r.min ?? ""} />
              <Label htmlFor={`datos-t-${i}-max`}>Máximo permitido (opcional)</Label>
              <Input disabled={disabled} id={`datos-t-${i}-max`} onChange={(e) => set(i, { max: e.target.value })} value={r.max ?? ""} />
              <label className="flex items-center gap-2 text-sm"><input checked={!!r.startAtZero} disabled={disabled} onChange={(e) => set(i, { startAtZero: e.target.checked })} type="checkbox" />Si el campo no existe, empezar en 0</label>
            </>
          )}
          {r.operation === "updateIfMatches" && (
            <>
              <Label htmlFor={`datos-t-${i}-exp`}>Valor esperado actual</Label>
              <Input disabled={disabled} id={`datos-t-${i}-exp`} onChange={(e) => setText(i, "expected", e.target.value)} placeholder='{"estado": "pendiente"}' value={shown(i, "expected", r.expected)} />
              {valueKindHint(r.expected) && <p className="text-muted-foreground text-xs">{valueKindHint(r.expected)}</p>}
            </>
          )}
          {(r.operation === "saveIfAbsent" || r.operation === "updateIfMatches") && (
            <>
              <Label htmlFor={`datos-t-${i}-val`}>{r.operation === "updateIfMatches" ? "Valor nuevo" : "Valor"}</Label>
              <Input disabled={disabled} id={`datos-t-${i}-val`} onChange={(e) => setText(i, "value", e.target.value)} placeholder='{"estado": "pagado"}' value={shown(i, "value", r.value)} />
              {valueKindHint(r.value) && <p className="text-muted-foreground text-xs">{valueKindHint(r.value)}</p>}
            </>
          )}
          </>
          )}
        </div>
      ))}
      <Button disabled={disabled || rows.length >= TOGETHER_MAX} onClick={() => onChange(serializeTogether([...rows, { operation: "add", collection: "", key: "", field: "", amount: "" }]))} size="sm" type="button" variant="outline">
        <Plus className="mr-1 size-4" />
        Agregar cambio
      </Button>
      {check.general.length > 0 && <p className="text-destructive text-xs" role="alert">{check.general.join(" ")}</p>}
      {rows.length >= TOGETHER_MAX && <p className="text-muted-foreground text-xs">Máximo {TOGETHER_MAX} cambios.</p>}
    </div>
  );
}

// Datos fields component (generic per-company records; prototype)
function DatosFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  const operation = (config?.operation as string) || "";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="datos-operation">Qué hacer</Label>
        <select
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          disabled={disabled}
          id="datos-operation"
          onChange={(e) => onUpdateConfig("operation", e.target.value)}
          value={operation}
        >
          <option value="" disabled>Elegí qué hacer</option>
          <option value="save">Guardar un dato</option>
          <option value="saveIfAbsent">Guardar solo si no existe</option>
          <option value="updateIfMatches">Actualizar solo si el valor actual coincide</option>
          <option value="add">Sumar a un número</option>
          <option value="applyTogether">Aplicar cambios juntos (todos o ninguno)</option>
          <option value="read">Leer un dato</option>
          <option value="list">Listar los últimos datos</option>
          <option value="fields">Definir campos de la colección (opcional)</option>
        </select>
      </div>
      {operation !== "applyTogether" && (
      <div className="space-y-2">
        <Label htmlFor="datos-collection">Colección</Label>
        <Input
          disabled={disabled}
          id="datos-collection"
          onChange={(e) => onUpdateConfig("collection", e.target.value)}
          placeholder="productos"
          value={(config?.collection as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          Minúsculas, números y _ (por ejemplo: productos). Los datos son de tu empresa.
        </p>
      </div>
      )}
      {operation !== "list" && operation !== "fields" && operation !== "applyTogether" && (
        <div className="space-y-2">
          <Label htmlFor="datos-key">Clave</Label>
          <Input
            disabled={disabled}
            id="datos-key"
            onChange={(e) => onUpdateConfig("key", e.target.value)}
            placeholder="SKU-123"
            value={(config?.key as string) || ""}
          />
        </div>
      )}
      {operation === "applyTogether" && (
        <DatosTogetherEditor disabled={disabled} onChange={(v) => onUpdateConfig("operations", v)} value={(config?.operations as string) || ""} />
      )}
      {operation === "add" && (
        <div className="space-y-2">
          <Label htmlFor="datos-field">Campo numérico</Label>
          <Input disabled={disabled} id="datos-field" onChange={(e) => onUpdateConfig("field", e.target.value)} placeholder="stock" value={(config?.field as string) || ""} />
          <Label htmlFor="datos-amount">Cantidad a sumar (negativa para restar)</Label>
          <Input disabled={disabled} id="datos-amount" onChange={(e) => onUpdateConfig("amount", e.target.value)} placeholder="-1" value={(config?.amount as string) || ""} />
          <Label htmlFor="datos-min">Mínimo permitido (opcional)</Label>
          <Input disabled={disabled} id="datos-min" onChange={(e) => onUpdateConfig("min", e.target.value)} placeholder="0" value={(config?.min as string) || ""} />
          <Label htmlFor="datos-max">Máximo permitido (opcional)</Label>
          <Input disabled={disabled} id="datos-max" onChange={(e) => onUpdateConfig("max", e.target.value)} placeholder="" value={(config?.max as string) || ""} />
          <label className="flex items-center gap-2 text-sm" htmlFor="datos-start-zero">
            <input checked={config?.startAtZero === "true" || config?.startAtZero === true} disabled={disabled} id="datos-start-zero" onChange={(e) => onUpdateConfig("startAtZero", e.target.checked ? "true" : "false")} type="checkbox" />
            Si el campo no existe, empezar en 0
          </label>
          <div className="space-y-1 text-sm">
            <p className="text-foreground/80">Suma o resta en un solo paso, sin pisar cambios simultáneos. Si queda fuera del mínimo/máximo no cambia nada y devuelve aplicado = falso: usá un nodo Condición sobre aplicado.</p>
            <details className="text-foreground/70">
              <summary className="cursor-pointer font-medium">Más detalles</summary>
              <p className="mt-1">Si este mismo paso se reintenta dentro de la misma ejecución, no suma dos veces y devuelve el mismo resultado que la primera vez (con repetido = verdadero). Una ejecución nueva sí suma: si el mismo evento puede llegar repetido (por ejemplo un aviso de venta duplicado), antes usá &quot;Guardar solo si no existe&quot; con una clave única por evento y sumá solo si creado = verdadero.</p>
            </details>
          </div>
        </div>
      )}
      {operation === "updateIfMatches" && (
        <div className="space-y-2">
          <Label htmlFor="datos-expected">Valor esperado actual</Label>
          <Input disabled={disabled} id="datos-expected" onChange={(e) => onUpdateConfig("expected", e.target.value)} placeholder='{"estado": "pendiente"}' value={(config?.expected as string) || ""} />
          <div className="space-y-1 text-sm">
            <p className="text-foreground/80">Cambia el dato solo si es igual a este valor (1 y 1.0 son iguales). Si no coincide o no existe, no cambia nada y devuelve actualizado = falso: usá un nodo Condición sobre actualizado.</p>
            <details className="text-foreground/70">
              <summary className="cursor-pointer font-medium">Más detalles</summary>
              <p className="mt-1">Si este mismo paso se reintenta dentro de la misma ejecución, devuelve el mismo resultado que la primera vez (con repetido = verdadero) y no vuelve a aplicar el cambio, aunque el dato haya cambiado en el medio.</p>
            </details>
          </div>
        </div>
      )}
      {(operation === "save" || operation === "saveIfAbsent" || operation === "updateIfMatches") && (
        <div className="space-y-2">
          <Label htmlFor="datos-value">{operation === "updateIfMatches" ? "Valor nuevo" : "Valor"}</Label>
          <Input
            disabled={disabled}
            id="datos-value"
            onChange={(e) => onUpdateConfig("value", e.target.value)}
            placeholder='{"stock": 3}'
            value={(config?.value as string) || ""}
          />
          <p className="text-muted-foreground text-xs">
            Texto o JSON, hasta 16 KB.
            {operation === "saveIfAbsent" ? " Si la clave ya existe, no se cambia y se devuelve el dato existente (creado = falso)." : ""}
          </p>
        </div>
      )}
      {operation === "fields" && (
        <div className="space-y-2">
          <Label htmlFor="datos-fields">Campos</Label>
          <textarea
            className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            disabled={disabled}
            id="datos-fields"
            onChange={(e) => onUpdateConfig("fields", e.target.value)}
            placeholder={"nombre:texto:obligatorio\nprecio:numero\nactivo:booleano\nalta:fecha"}
            value={(config?.fields as string) || ""}
          />
          <p className="text-muted-foreground text-xs">
            Un campo por línea: nombre:tipo (texto, numero, booleano, fecha) o nombre:tipo:obligatorio.
            Desde ese momento, Guardar en esta colección acepta solo objetos con esos campos.
            Los registros ya guardados no se cambian ni se borran.
          </p>
        </div>
      )}
      {operation === "list" && (
        <div className="space-y-2">
          <Label htmlFor="datos-limit">Cantidad máxima</Label>
          <Input
            disabled={disabled}
            id="datos-limit"
            min={1}
            onChange={(e) => onUpdateConfig("limit", e.target.value)}
            placeholder="50"
            type="number"
            value={(config?.limit as string) || ""}
          />
        </div>
      )}
    </div>
  );
}

function DelayFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="delay-minutes">Minutos</Label>
        <Input
          disabled={disabled}
          id="delay-minutes"
          min={0}
          onChange={(e) => onUpdateConfig("durationMinutes", e.target.value)}
          placeholder="10"
          type="number"
          value={(config?.durationMinutes as string) || ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="delay-seconds">Segundos</Label>
        <Input
          disabled={disabled}
          id="delay-seconds"
          min={0}
          onChange={(e) => onUpdateConfig("durationSeconds", e.target.value)}
          placeholder="0"
          type="number"
          value={(config?.durationSeconds as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          El flujo espera este tiempo antes de seguir (máximo 24 horas). La
          espera no consume ejecución: el flujo se pausa y retoma.
        </p>
      </div>
    </div>
  );
}

// Unir (join) fields component
function UnirFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  const mode = config?.joinMode === "timeout" ? "timeout" : "all";
  const selectClass =
    "h-9 w-full rounded-md border bg-transparent px-2 text-sm";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="unir-mode">Cuándo seguir</Label>
        <select
          className={selectClass}
          disabled={disabled}
          id="unir-mode"
          onChange={(e) => onUpdateConfig("joinMode", e.target.value)}
          value={mode}
        >
          <option value="all">Esperar a todas las ramas</option>
          <option value="timeout">Esperar hasta un tiempo máximo</option>
        </select>
      </div>
      {mode === "timeout" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="unir-seconds">Tiempo máximo (segundos)</Label>
            <Input
              disabled={disabled}
              id="unir-seconds"
              min={1}
              onChange={(e) => onUpdateConfig("timeoutSeconds", e.target.value)}
              placeholder="Segundos"
              type="number"
              value={(config?.timeoutSeconds as string) || ""}
            />
            <p className="text-muted-foreground text-xs">
              Se cuenta desde que llega la primera rama (máximo 24 horas). Si
              todas llegan antes, sigue sin esperar el tiempo completo.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unir-timeout">Si se acaba el tiempo</Label>
            <select
              className={selectClass}
              disabled={disabled}
              id="unir-timeout"
              onChange={(e) => onUpdateConfig("onTimeout", e.target.value)}
              value={config?.onTimeout === "continue" ? "continue" : "fail"}
            >
              <option value="fail">Frenar el flujo</option>
              <option value="continue">Seguir con lo que llegó</option>
            </select>
            <p className="text-muted-foreground text-xs">
              Esto solo impide que sigan los pasos de después. Las ramas que
              todavía no terminaron siguen corriendo hasta el final (incluidos
              pasos que gastan, como generar video): no se cancelan.
            </p>
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor="unir-fail">Si una rama falla</Label>
        <select
          className={selectClass}
          disabled={disabled}
          id="unir-fail"
          onChange={(e) => onUpdateConfig("onParentFailure", e.target.value)}
          value={config?.onParentFailure === "continue" ? "continue" : "fail"}
        >
          <option value="fail">Fallar (no sigue)</option>
          <option value="continue">Seguir con las ramas que funcionaron</option>
        </select>
        <p className="text-muted-foreground text-xs">
          Una rama que no corrió por una Condición falsa nunca bloquea la unión.
          Salida: inputs (datos por rama), completed, failed, skipped, timedOut.
        </p>
      </div>
    </div>
  );
}

// Approval fields component
function ApprovalFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="approval-message">Qué tiene que revisar la persona</Label>
        <TemplateBadgeTextarea
          disabled={disabled}
          id="approval-message"
          onChange={(value) => onUpdateConfig("message", value)}
          placeholder="Ej: Revisá los 3 artículos generados y aprobá para publicar el elegido."
          rows={4}
          value={(config?.message as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          El flujo se pausa acá y muestra Aprobar/Rechazar en la ejecución. Si
          rechazan, el flujo termina con error. La salida expone
          {" "}
          {"{{@...approved}}"} y {"{{@...note}}"}.
        </p>
      </div>
    </div>
  );
}

// Loop fields component
function LoopFields({
  config,
  onUpdateConfig,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  const innerSteps = Array.isArray(config?.steps)
    ? (config.steps as Array<{ id?: string; actionType?: string }>)
    : [];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="loop-source">Lista a recorrer</Label>
        <TemplateBadgeInput
          disabled={disabled}
          id="loop-source"
          onChange={(value) => onUpdateConfig("source", value)}
          placeholder="e.g., {{@search-orders:Search Orders.orders}}"
          value={(config?.source as string) || ""}
        />
        <p className="text-muted-foreground text-xs">
          Reference an array field from a previous step. Inside the repeated
          steps, use @item for the current item and @index for its position.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="loop-max">Máximo de ítems (hasta 50)</Label>
        <Input
          disabled={disabled}
          id="loop-max"
          max={50}
          min={1}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdateConfig("maxItems", e.target.value)}
          type="number"
          value={String(config?.maxItems ?? 50)}
        />
      </div>
      <div className="space-y-2">
        <Label>Steps repeated per item</Label>
        {innerSteps.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {innerSteps.map((step, i) => (
              <li key={step.id || i}>{step.actionType || "Paso sin configurar"}</li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-xs">
            No inner steps yet. Ask the chat to build the loop for you.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Items that fail are marked and the run continues with the next one.
          The output includes results, failed, count and failedCount.
        </p>
      </div>
    </div>
  );
}

// System action fields wrapper - extracts conditional rendering to reduce complexity
function SystemActionFields({
  actionType,
  config,
  onUpdateConfig,
  disabled,
}: {
  actionType: string;
  config: Record<string, unknown>;
  onUpdateConfig: (key: string, value: string) => void;
  disabled: boolean;
}) {
  switch (actionType) {
    case "HTTP Request":
      return (
        <HttpRequestFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Database Query":
      return (
        <DatabaseQueryFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Condition":
      return (
        <ConditionFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Fórmula":
      return (
        <FormulaFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Frontend":
      return (
        <FrontendFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Datos":
      return (
        <DatosFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Delay":
      return (
        <DelayFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Unir":
      return (
        <UnirFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Approval":
      return (
        <ApprovalFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    case "Loop":
      return (
        <LoopFields
          config={config}
          disabled={disabled}
          onUpdateConfig={onUpdateConfig}
        />
      );
    default:
      return null;
  }
}

// System actions that don't have plugins
const SYSTEM_ACTIONS: Array<{ id: string; label: string }> = [
  { id: "HTTP Request", label: "HTTP Request" },
  { id: "Database Query", label: "Database Query" },
  { id: "Condition", label: "Condition" },
  { id: "Loop", label: "Loop" },
  { id: "Fórmula", label: "Fórmula" },
  { id: "Delay", label: "Delay" },
  { id: "Unir", label: "Unir" },
  { id: "Datos", label: "Datos" },
  { id: "Frontend", label: "Frontend" },
];

const SYSTEM_ACTION_IDS = SYSTEM_ACTIONS.map((a) => a.id);

// System actions that need integrations (not in plugin registry)
const SYSTEM_ACTION_INTEGRATIONS: Record<string, IntegrationType> = {
  "Database Query": "database",
};

// Build category mapping dynamically from plugins + System
function useCategoryData() {
  return useMemo(() => {
    const pluginCategories = getActionsByCategory();

    // Build category map including System with both id and label
    const allCategories: Record<
      string,
      Array<{ id: string; label: string }>
    > = {
      System: SYSTEM_ACTIONS,
    };

    for (const [category, actions] of Object.entries(pluginCategories)) {
      allCategories[category] = actions.map((a) => ({
        id: a.id,
        label: a.label,
      }));
    }

    return allCategories;
  }, []);
}

// Get category for an action type (supports both new IDs, labels, and legacy labels)
function getCategoryForAction(actionType: string): string | null {
  // Check system actions first
  if (SYSTEM_ACTION_IDS.includes(actionType)) {
    return "System";
  }

  // Use findActionById which handles legacy labels from plugin registry
  const action = findActionById(actionType);
  if (action?.category) {
    return action.category;
  }

  return null;
}

// Normalize action type to new ID format (handles legacy labels via findActionById)
function normalizeActionType(actionType: string): string {
  // Check system actions first - they use their label as ID
  if (SYSTEM_ACTION_IDS.includes(actionType)) {
    return actionType;
  }

  // Use findActionById which handles legacy labels and returns the proper ID
  const action = findActionById(actionType);
  if (action) {
    return action.id;
  }

  return actionType;
}

export function ActionConfig({
  config,
  onUpdateConfig,
  disabled,
  isOwner = true,
}: ActionConfigProps) {
  const actionType = (config?.actionType as string) || "";
  const categories = useCategoryData();
  const integrations = useMemo(() => getAllIntegrations(), []);

  const selectedCategory = actionType ? getCategoryForAction(actionType) : null;
  const [category, setCategory] = useState<string>(selectedCategory || "");
  const setIntegrationsVersion = useSetAtom(integrationsVersionAtom);
  const globalIntegrations = useAtomValue(integrationsAtom);
  const { push } = useOverlay();

  // AI Gateway managed keys state
  const aiGatewayStatus = useAtomValue(aiGatewayStatusAtom);

  // Sync category state when actionType changes (e.g., when switching nodes)
  useEffect(() => {
    const newCategory = actionType ? getCategoryForAction(actionType) : null;
    setCategory(newCategory || "");
  }, [actionType]);

  const handleCategoryChange = (newCategory: string) => {
    setCategory(newCategory);
    // Auto-select the first action in the new category
    const firstAction = categories[newCategory]?.[0];
    if (firstAction) {
      onUpdateConfig("actionType", firstAction.id);
    }
  };

  const handleActionTypeChange = (value: string) => {
    onUpdateConfig("actionType", value);
  };

  // Adapter for plugin config components that expect (key, value: unknown)
  const handlePluginUpdateConfig = (key: string, value: unknown) => {
    onUpdateConfig(key, String(value));
  };

  // Get dynamic config fields for plugin actions
  const pluginAction = actionType ? findActionById(actionType) : null;

  // Determine the integration type for the current action
  const integrationType: IntegrationType | undefined = useMemo(() => {
    if (!actionType) {
      return;
    }

    // Check system actions first
    if (SYSTEM_ACTION_INTEGRATIONS[actionType]) {
      return SYSTEM_ACTION_INTEGRATIONS[actionType];
    }

    // Check plugin actions
    const action = findActionById(actionType);
    // Composio uses the server project key, not a per-user credential record.
    if (action?.integration === "composio") return undefined;
    return action?.integration as IntegrationType | undefined;
  }, [actionType]);

  // Check if AI Gateway managed keys should be offered (user can have multiple for different teams)
  const shouldUseManagedKeys =
    integrationType === "ai-gateway" &&
    aiGatewayStatus?.enabled &&
    aiGatewayStatus?.isVercelUser;

  // Check if there are existing connections for this integration type
  const hasExistingConnections = useMemo(() => {
    if (!integrationType) return false;
    return globalIntegrations.some((i) => i.type === integrationType);
  }, [integrationType, globalIntegrations]);

  const handleConsentSuccess = (integrationId: string) => {
    onUpdateConfig("integrationId", integrationId);
    setIntegrationsVersion((v) => v + 1);
  };

  const openConnectionOverlay = () => {
    if (integrationType) {
      push(ConfigureConnectionOverlay, {
        type: integrationType,
        onSuccess: (integrationId: string) => {
          setIntegrationsVersion((v) => v + 1);
          onUpdateConfig("integrationId", integrationId);
        },
      });
    }
  };

  const handleAddSecondaryConnection = () => {
    if (shouldUseManagedKeys) {
      push(AiGatewayConsentOverlay, {
        onConsent: handleConsentSuccess,
        onManualEntry: openConnectionOverlay,
      });
    } else {
      openConnectionOverlay();
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label className="ml-1" htmlFor="actionCategory">
            Servicio
          </Label>
          <Select
            disabled={disabled}
            onValueChange={handleCategoryChange}
            value={category || undefined}
          >
            <SelectTrigger className="w-full" id="actionCategory">
              <SelectValue placeholder="Elegí una categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="System">
                <div className="flex items-center gap-2">
                  <Settings className="size-4" />
                  <span>System</span>
                </div>
              </SelectItem>
              <SelectSeparator />
              {integrations.map((integration) => (
                <SelectItem key={integration.type} value={integration.label}>
                  <div className="flex items-center gap-2">
                    <IntegrationIcon
                      className="size-4"
                      integration={integration.type}
                    />
                    <span>{integration.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="ml-1" htmlFor="actionType">
            Acción
          </Label>
          <Select
            disabled={disabled || !category}
            onValueChange={handleActionTypeChange}
            value={normalizeActionType(actionType) || undefined}
          >
            <SelectTrigger className="w-full" id="actionType">
              <SelectValue placeholder="Elegí una acción" />
            </SelectTrigger>
            <SelectContent>
              {category &&
                categories[category]?.map((action) => (
                  <SelectItem key={action.id} value={action.id}>
                    {action.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {integrationType && isOwner && (
        <div className="space-y-2">
          <div className="ml-1 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label>Conexión</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>API key o credenciales OAuth del servicio</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {hasExistingConnections && (
              <Button
                className="size-6"
                disabled={disabled}
                onClick={handleAddSecondaryConnection}
                size="icon"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            )}
          </div>
          <IntegrationSelector
            disabled={disabled}
            integrationType={integrationType}
            onChange={(id) => onUpdateConfig("integrationId", id)}
            skipAutoSelect={!config?.integrationId && !!config?.fromTemplate}
            value={(config?.integrationId as string) || ""}
          />
        </div>
      )}

      {/* System actions - hardcoded config fields */}
      <SystemActionFields
        actionType={(config?.actionType as string) || ""}
        config={config}
        disabled={disabled}
        onUpdateConfig={onUpdateConfig}
      />

      {/* Plugin actions - declarative config fields */}
      {pluginAction && !SYSTEM_ACTION_IDS.includes(actionType) && (
        <ActionConfigRenderer
          config={config}
          disabled={disabled}
          fields={pluginAction.configFields}
          onUpdateConfig={handlePluginUpdateConfig}
        />
      )}
    </>
  );
}
