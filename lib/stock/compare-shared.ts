/**
 * Pure stock-comparison logic: Mercado Libre stock snapshot vs Tiendanube
 * product list, matched through an equivalence table or direct SKU equality.
 * Kept free of "server-only" and credential imports so node:test can run
 * fixture tests against it without a Next.js runtime.
 *
 * Rules (card 11): never invent matches. Missing/duplicate SKUs, ambiguous
 * equivalences and empty inputs are reported separately from "stock equal".
 */

export type MlVariationShape = {
  id?: number;
  availableQuantity?: number;
  sku?: string | null;
  combination?: string;
};
export type MlItemShape = {
  id?: string;
  title?: string;
  status?: string;
  availableQuantity?: number;
  sku?: string | null;
  variations?: MlVariationShape[];
};
export type TnVariantShape = { id?: number; sku?: string | null; stock?: number | null };
export type TnProductShape = {
  id?: number;
  name?: string;
  variants?: TnVariantShape[];
};
/** One equivalence row: the ML SELLER_SKU and the TN variant sku it maps to. */
export type StockEquivalence = { mlSku: string; tnSku: string };

export type CompareEstado =
  | "ok"
  | "diferente"
  | "sin_sku_ml"
  | "ml_sku_duplicado"
  | "tn_sku_duplicado"
  | "equivalencia_ambigua"
  | "equivalencia_sin_destino"
  | "solo_en_ml"
  | "solo_en_tn";

export type CompareRow = {
  estado: CompareEstado;
  mlSku: string | null;
  tnSku: string | null;
  mlStock: number | null;
  tnStock: number | null;
  via: "equivalencia" | "sku-directo" | null;
  mlRef: string | null;
  tnRef: string | null;
};

export type CompareResumen = Record<CompareEstado, number> & {
  mlVacio: boolean;
  tnVacio: boolean;
};

export type CompareReport = { resumen: CompareResumen; filas: CompareRow[] };

type MlEmit = { sku: string | null; stock: number; ref: string | null };

function flattenMl(items: MlItemShape[]): MlEmit[] {
  const out: MlEmit[] = [];
  for (const item of items) {
    const variations = item.variations ?? [];
    if (variations.length === 0) {
      out.push({
        sku: item.sku ?? null,
        stock: item.availableQuantity ?? 0,
        ref: item.title || item.id || null,
      });
    }
    for (const v of variations) {
      out.push({
        sku: v.sku ?? null,
        stock: v.availableQuantity ?? 0,
        ref: [item.title || item.id || "", v.combination || (v.id != null ? `var ${v.id}` : "")]
          .filter(Boolean)
          .join(" · ") || null,
      });
    }
  }
  return out;
}

function emptyResumen(): CompareResumen {
  return {
    ok: 0,
    diferente: 0,
    sin_sku_ml: 0,
    ml_sku_duplicado: 0,
    tn_sku_duplicado: 0,
    equivalencia_ambigua: 0,
    equivalencia_sin_destino: 0,
    solo_en_ml: 0,
    solo_en_tn: 0,
    mlVacio: false,
    tnVacio: false,
  };
}

export function compareStock(
  mlItems: MlItemShape[],
  tnProducts: TnProductShape[],
  equivalences: StockEquivalence[]
): CompareReport {
  const resumen = emptyResumen();
  const filas: CompareRow[] = [];
  resumen.mlVacio = mlItems.length === 0;
  resumen.tnVacio = tnProducts.length === 0;

  const push = (row: CompareRow) => {
    filas.push(row);
    resumen[row.estado] += 1;
  };

  // TN index by sku; a sku present on more than one variant is ambiguous and
  // never matched.
  const tnBySku = new Map<string, { stock: number | null; ref: string | null; dup: boolean }>();
  for (const p of tnProducts) {
    for (const v of p.variants ?? []) {
      const sku = v.sku ?? null;
      if (!sku) continue;
      const ref = p.name || (p.id != null ? `producto ${p.id}` : null);
      const prev = tnBySku.get(sku);
      tnBySku.set(sku, prev ? { ...prev, dup: true } : { stock: v.stock ?? null, ref, dup: false });
    }
  }

  // Equivalence indexes; same mlSku twice or same tnSku twice is ambiguous.
  const eqByMl = new Map<string, { tnSku: string; dup: boolean }>();
  const eqTnCount = new Map<string, number>();
  for (const e of equivalences) {
    if (!e.mlSku || !e.tnSku) continue;
    const prev = eqByMl.get(e.mlSku);
    eqByMl.set(e.mlSku, prev ? { tnSku: prev.tnSku, dup: true } : { tnSku: e.tnSku, dup: false });
    eqTnCount.set(e.tnSku, (eqTnCount.get(e.tnSku) ?? 0) + 1);
  }

  // ML duplicate detection (same sku on several items/variations).
  const mlEmits = flattenMl(mlItems);
  const mlSkuCount = new Map<string, number>();
  for (const m of mlEmits) if (m.sku) mlSkuCount.set(m.sku, (mlSkuCount.get(m.sku) ?? 0) + 1);

  const usedTn = new Set<string>();

  for (const m of mlEmits) {
    if (!m.sku) {
      push({ estado: "sin_sku_ml", mlSku: null, tnSku: null, mlStock: m.stock, tnStock: null, via: null, mlRef: m.ref, tnRef: null });
      continue;
    }
    if ((mlSkuCount.get(m.sku) ?? 0) > 1) {
      push({ estado: "ml_sku_duplicado", mlSku: m.sku, tnSku: null, mlStock: m.stock, tnStock: null, via: null, mlRef: m.ref, tnRef: null });
      continue;
    }
    const eq = eqByMl.get(m.sku);
    if (eq?.dup || (eq && (eqTnCount.get(eq.tnSku) ?? 0) > 1)) {
      push({ estado: "equivalencia_ambigua", mlSku: m.sku, tnSku: eq.tnSku, mlStock: m.stock, tnStock: null, via: null, mlRef: m.ref, tnRef: null });
      continue;
    }
    if (eq && !tnBySku.has(eq.tnSku)) {
      push({ estado: "equivalencia_sin_destino", mlSku: m.sku, tnSku: eq.tnSku, mlStock: m.stock, tnStock: null, via: "equivalencia", mlRef: m.ref, tnRef: null });
      continue;
    }
    const tnSku = eq ? eq.tnSku : tnBySku.has(m.sku) ? m.sku : null;
    if (!tnSku) {
      push({ estado: "solo_en_ml", mlSku: m.sku, tnSku: null, mlStock: m.stock, tnStock: null, via: null, mlRef: m.ref, tnRef: null });
      continue;
    }
    const tn = tnBySku.get(tnSku)!;
    if (tn.dup) {
      push({ estado: "tn_sku_duplicado", mlSku: m.sku, tnSku, mlStock: m.stock, tnStock: null, via: eq ? "equivalencia" : "sku-directo", mlRef: m.ref, tnRef: null });
      continue;
    }
    usedTn.add(tnSku);
    push({
      estado: tn.stock === m.stock ? "ok" : "diferente",
      mlSku: m.sku,
      tnSku,
      mlStock: m.stock,
      tnStock: tn.stock,
      via: eq ? "equivalencia" : "sku-directo",
      mlRef: m.ref,
      tnRef: tn.ref,
    });
  }

  for (const [sku, tn] of tnBySku) {
    if (usedTn.has(sku)) continue;
    if (tn.dup) {
      push({ estado: "tn_sku_duplicado", mlSku: null, tnSku: sku, mlStock: null, tnStock: null, via: null, mlRef: null, tnRef: tn.ref });
    } else {
      push({ estado: "solo_en_tn", mlSku: null, tnSku: sku, mlStock: null, tnStock: tn.stock, via: null, mlRef: null, tnRef: tn.ref });
    }
  }

  return { resumen, filas };
}
