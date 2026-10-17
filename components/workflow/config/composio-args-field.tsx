"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TemplateBadgeInput } from "@/components/ui/template-badge-input";
import { TemplateBadgeTextarea } from "@/components/ui/template-badge-textarea";

type JsonSchemaProp = {
  type?: string;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  title?: string;
};

type ToolSchema = {
  properties: Record<string, JsonSchemaProp>;
  required: string[];
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; schema: ToolSchema };

function parseSchema(raw: unknown): ToolSchema {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const properties =
    obj.properties && typeof obj.properties === "object"
      ? (obj.properties as Record<string, JsonSchemaProp>)
      : {};
  const required = Array.isArray(obj.required)
    ? obj.required.filter((r): r is string => typeof r === "string")
    : [];
  return { properties, required };
}

function parseArgs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function displayValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function coerce(raw: string, prop: JsonSchemaProp): unknown {
  if (prop.type === "number" || prop.type === "integer") {
    const trimmed = raw.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
      return prop.type === "integer" ? Math.trunc(Number(trimmed)) : Number(trimmed);
    }
    return raw; // keep templates like {{ steps.x.output }} as strings
  }
  if (prop.type === "boolean") return raw === "true";
  if (prop.type === "array" || prop.type === "object") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  toolkit: string;
  tool: string;
  disabled?: boolean;
};

/**
 * Schema-driven parameter form for composio/run-tool.
 * Fetches the tool's input schema and renders one field per parameter,
 * storing everything back into the `arguments` JSON string (execution unchanged).
 * Falls back to a JSON textarea when the schema cannot be loaded.
 */
export function ComposioArgsField({ value, onChange, toolkit, tool, disabled }: Props) {
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const lastEmitted = useRef<string | null>(null);
  const requestId = useRef(0);

  const toolkitOk = /^[a-z0-9_]{1,60}$/.test(toolkit.trim());
  const toolOk = /^[A-Za-z0-9_]{1,80}$/.test(tool.trim());

  // Fetch the schema when toolkit/tool change (debounced)
  useEffect(() => {
    if (!toolkitOk || !toolOk) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/composio-tools?toolkit=${encodeURIComponent(toolkit.trim())}&tool=${encodeURIComponent(tool.trim())}`
        );
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        if (requestId.current !== id) return;
        setState({ status: "ready", schema: parseSchema(data.item?.inputParameters) });
      } catch {
        if (requestId.current !== id) return;
        setState({ status: "error" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [toolkit, tool, toolkitOk, toolOk]);

  // Sync local field state from the incoming JSON (node switch, external edits)
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const obj = parseArgs(value);
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) next[k] = displayValue(v);
    setFields(next);
  }, [value]);

  const emit = (next: Record<string, string>, schema: ToolSchema | null) => {
    const obj = parseArgs(value); // preserve params outside the schema
    const known = new Set(Object.keys(schema?.properties ?? {}));
    if (schema) {
      for (const key of known) delete obj[key];
    }
    for (const [key, raw] of Object.entries(next)) {
      if (raw === "") continue;
      if (schema && !known.has(key)) continue; // stale key from a previous tool
      obj[key] = coerce(raw, schema?.properties[key] ?? {});
    }
    const json = JSON.stringify(obj);
    lastEmitted.current = json;
    setFields(next);
    onChange(json);
  };

  if (!toolkitOk || !toolOk) {
    return (
      <p className="text-muted-foreground text-xs">
        Choose an app and an action above to see its parameters.
      </p>
    );
  }

  if (state.status === "loading") {
    return <p className="text-muted-foreground text-xs">Loading parameters…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          Could not load the parameter schema. Edit the JSON directly:
        </p>
        <TemplateBadgeTextarea
          disabled={disabled}
          id="arguments"
          onChange={(v) => {
            lastEmitted.current = v;
            onChange(v);
          }}
          rows={4}
          value={value}
        />
      </div>
    );
  }

  if (state.status !== "ready") return null;
  const schema = state.schema;
  const entries = Object.entries(schema.properties);

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This action has no parameters.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map(([name, prop]) => {
        const isRequired = schema.required.includes(name);
        const current = fields[name] ?? "";
        const setOne = (raw: string) => emit({ ...fields, [name]: raw }, schema);
        const label = prop.title || name;
        const enumValues =
          Array.isArray(prop.enum) && prop.enum.length > 0
            ? prop.enum.map((e) => String(e))
            : null;
        return (
          <div className="space-y-1" key={name}>
            <Label className="ml-1" htmlFor={`arg-${name}`}>
              {label}
              {isRequired && <span className="text-red-500">*</span>}
            </Label>
            {prop.type === "boolean" ? (
              <Select
                disabled={disabled}
                onValueChange={(v) => setOne(v === "__unset__" ? "" : v)}
                value={current === "" ? "__unset__" : current}
              >
                <SelectTrigger className="w-full" id={`arg-${name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Not set</SelectItem>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : enumValues ? (
              <Select
                disabled={disabled}
                onValueChange={setOne}
                value={current || undefined}
              >
                <SelectTrigger className="w-full" id={`arg-${name}`}>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {enumValues.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                  {current && !enumValues.includes(current) && (
                    <SelectItem value={current}>{current}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            ) : prop.type === "array" || prop.type === "object" ? (
              <TemplateBadgeTextarea
                disabled={disabled}
                id={`arg-${name}`}
                onChange={setOne}
                placeholder={prop.type === "array" ? "[]" : "{}"}
                rows={2}
                value={current}
              />
            ) : (
              <TemplateBadgeInput
                disabled={disabled}
                id={`arg-${name}`}
                onChange={setOne}
                placeholder={
                  prop.default !== undefined ? String(prop.default) : undefined
                }
                value={current}
              />
            )}
            {prop.description && (
              <p className="ml-1 text-muted-foreground text-xs">
                {prop.description.slice(0, 180)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
