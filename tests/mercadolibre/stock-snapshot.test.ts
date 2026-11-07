import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chunkIds,
  mapItemBody,
  skuOf,
} from "../../plugins/mercadolibre/steps/stock-snapshot-shared";

// Parser tests use payloads shaped like the documented ML responses
// (developers.mercadolibre.com.ar, Items & Searches / Variations).

test("skuOf reads SELLER_SKU and ignores other attributes", () => {
  assert.equal(
    skuOf([
      { id: "BRAND", value_name: "Acme" },
      { id: "SELLER_SKU", value_name: "ZAP-ROJA-42" },
    ]),
    "ZAP-ROJA-42"
  );
  assert.equal(skuOf([{ id: "BRAND", value_name: "Acme" }]), null);
  assert.equal(skuOf(undefined), null);
  assert.equal(skuOf([{ id: "SELLER_SKU" }]), null);
});

test("mapItemBody maps item-level fields and SKU", () => {
  const item = mapItemBody({
    id: "MLA123",
    title: "Zapatillas",
    status: "active",
    available_quantity: 7,
    attributes: [{ id: "SELLER_SKU", value_name: "ZAP-1" }],
  });
  assert.deepEqual(item, {
    id: "MLA123",
    title: "Zapatillas",
    status: "active",
    availableQuantity: 7,
    sku: "ZAP-1",
    variations: [],
  });
});

test("mapItemBody maps variations with their own stock, sku and combination", () => {
  const item = mapItemBody({
    id: "MLA9",
    title: "Remera",
    status: "active",
    available_quantity: 5,
    attributes: [],
    variations: [
      {
        id: 111,
        available_quantity: 2,
        attributes: [{ id: "SELLER_SKU", value_name: "REM-ROJA-S" }],
        attribute_combinations: [
          { name: "Color", value_name: "Roja" },
          { name: "Talle", value_name: "S" },
        ],
      },
      {
        id: 222,
        available_quantity: 3,
        attribute_combinations: [{ name: "Color", value_name: "Azul" }],
      },
    ],
  });
  assert.equal(item.sku, null);
  assert.equal(item.variations.length, 2);
  assert.deepEqual(item.variations[0], {
    id: 111,
    availableQuantity: 2,
    sku: "REM-ROJA-S",
    combination: "Color: Roja / Talle: S",
  });
  assert.equal(item.variations[1].sku, null);
  assert.equal(item.variations[1].combination, "Color: Azul");
});

test("mapItemBody tolerates missing fields", () => {
  assert.deepEqual(mapItemBody({}), {
    id: "",
    title: "",
    status: "",
    availableQuantity: 0,
    sku: null,
    variations: [],
  });
});

test("chunkIds batches by the multiget cap of 20", () => {
  const ids = Array.from({ length: 45 }, (_, i) => `MLA${i}`);
  const chunks = chunkIds(ids);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.length), [20, 20, 5]);
  assert.equal(chunkIds([]).length, 0);
  assert.equal(chunkIds(["a"]).length, 1);
  const twenty = chunkIds(Array.from({ length: 20 }, (_, i) => `${i}`));
  assert.equal(twenty.length, 1);
});

// Source-level guards for the deployed step contract.

test("stock-snapshot step is read-only and uses the documented routes", () => {
  const s = readFileSync(
    "plugins/mercadolibre/steps/stock-snapshot.ts",
    "utf8"
  );
  assert(!s.includes("method:"), "step must not set a write method");
  assert(s.includes('"/users/me"'));
  assert(s.includes("/items/search"));
  assert(s.includes("MULTIGET_CHUNK = 20"));
  assert(s.includes("attributes,variations"));
  assert(s.includes("stockSnapshotStep.maxRetries = 0"));
});

test("list-items also batches the multiget", () => {
  const s = readFileSync("plugins/mercadolibre/steps/list-items.ts", "utf8");
  assert(s.includes("chunkIds"));
  assert(!s.includes("ids.join"), "must not send all ids in one call");
});
