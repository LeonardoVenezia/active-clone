"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MANUAL_INPUT_MAX_VALUE, type ManualInputField, prepareInput } from "@/lib/manual-input";

type Req = { title: string; fields: ManualInputField[]; resolve: (v: Record<string, string> | null) => void };
const EVENT = "ac:ask-run-input";

/** Asks the user for the data a Manual trigger needs. Resolves with the values, or null if they cancel. Needs <RunInputHost /> mounted once. */
export function askRunInput(title: string, fields: ManualInputField[]): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    window.dispatchEvent(new CustomEvent<Req>(EVENT, { detail: { title, fields, resolve } }));
  });
}

export function RunInputHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<Req>).detail; setVals({}); setErr(""); setReq(d); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = (v: Record<string, string> | null) => { req?.resolve(v); setReq(null); };
  const submit = () => {
    if (!req) return;
    const { input, missing, tooLong } = prepareInput(req.fields, vals);
    if (missing.length) { setErr(`Falta completar: ${missing.join(", ")}`); return; }
    if (tooLong.length) { setErr(`Demasiado largo (máximo ${MANUAL_INPUT_MAX_VALUE} caracteres): ${tooLong.join(", ")}`); return; }
    close(input);
  };
  return (
    <Dialog onOpenChange={(o) => { if (!o) close(null); }} open={!!req}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{req?.title ?? "Datos para ejecutar"}</DialogTitle>
          <DialogDescription>Completá estos datos para esta ejecución.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {req?.fields.map((f, i) => (
            <div className="space-y-1" key={f.key}>
              <Label htmlFor={`run-input-${f.key}`}>{f.label}{f.required ? "" : " (opcional)"}</Label>
              <Input autoFocus={i === 0} id={`run-input-${f.key}`} maxLength={MANUAL_INPUT_MAX_VALUE} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} value={vals[f.key] ?? ""} />
            </div>
          ))}
          {err ? <p className="text-destructive text-sm" role="alert">{err}</p> : null}
          <DialogFooter>
            <Button onClick={() => close(null)} type="button" variant="outline">Cancelar</Button>
            <Button type="submit">Ejecutar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
