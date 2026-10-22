# Aceptación semántica (evals/semantic)

El PASS estructural (expects de `cases.jsonl`: tipos de nodo, toolkit, sin
huérfanos ni placeholders) no alcanza: un flujo puede tener la forma correcta
y no cumplir el pedido. Esta capa agrega **aceptación semántica**: simula la
ejecución del flujo contra un fixture con datos conocidos y verifica que la
salida (filas de Sheets, emails, Slack) contenga el resultado esperado.

## Piezas

- `simulate.mjs` — simulador determinístico del grafo. Replica la semántica de
  `lib/workflow-executor.workflow.ts`: `processTemplates` (valores faltantes →
  `""`, objetos → JSON), Condition con evaluación JS y gating de downstream
  (Condition false frena la rama; merge any-parent-una-vez), Fórmula con
  JSONata, Loop con inner steps (Condition false filtra el ítem, `results` =
  último step por ítem no filtrado). Divergencias declaradas: no aplica la
  whitelist de validación de expresiones (la entrada la genera nuestro
  builder) y los merges esperan a todos los padres (el executor real depende
  del timing de ramas paralelas).
- `fixtures/c09-reconciliation.json`, `fixtures/c12-stock.json` — mundos
  mockeados. Las formas de `sources` copian los outputs reales de los steps
  (`plugins/*/steps/*.ts`): si un campo no existe en el output real, no existe
  en el fixture. Así se detectan identificadores de cruce inventados.
- `check.mjs` — corre simulador + aserciones del caso.
  `node evals/semantic/check.mjs <C-09|C-12> <workflow.json>` (exit 0 = pass).
- `snapshots/` — grafos JSON de los workflows medidos (cuenta QA).

## Qué verifica cada caso

- **C-09**: el fixture tiene 2 pares que matchean, 1 cobro sin orden (pay_3) y
  1 orden sin cobro (ord_7). Verifica que ambos ids aparezcan en la salida y
  que los campos que el flujo usa para cruzar existan en los outputs reales
  (`list-payments` no expone `externalReference` ni metadata: el cruce posible
  hoy es por monto).
- **C-12**: la verdad son `productsTruth` (4 productos únicos con stock<5 →
  Slack esperado). Verifica cuántos productos únicos se identifican (no nodos
  ni filas), que no haya filas con celdas vacías (pérdida de identidad del
  ítem al encadenar loops), que no haya falsos positivos (órdenes baratas
  tratadas como stock bajo) y que Slack dispare si y solo si corresponde.

## Resultado vigente (2026-10-21)

`evals/runs/2026-10-21-semantic-c09-c12.jsonl`: los 4 workflows del run
estructural 6/6 **fallan la aceptación semántica** (0/4). Causas:

1. C-09-a: los loops solo extraen ids; nunca se comparan los listados; Sheets
   y Gmail escriben texto estático.
2. C-09-b: cruza por `externalReference`, campo que `list-payments` no devuelve
   (query vacío → trae todas las órdenes → no detecta nada); además solo mira
   una dirección (cobros sin orden) y pierde la identidad del ítem detectado.
3. C-12-a/b: usan `search-orders` como fuente de "productos" y comparan
   `Item.total` (total de la orden) como si fuera stock. El catálogo no tiene
   acción "listar productos" en tiendanube ni mercadolibre (solo get-product /
   get-item por ID) → el caso no es construible semánticamente hoy. Además
   C-12-a pierde la identidad del ítem (loop sobre `.results` de otro loop) y
   en ambos la condición ">3 en falta" no dispara Slack (cuenta 1 > 3).


## Resultado re7 (2026-10-22, post-reglas validator + fix sim)

Commit 15408f9: `conditionExpressionError` (conds con identificadores
inventados), listCrossing relajado (Fórmula ya no cuenta como joiner: el
FALLBACK legítimo), skip de placeholder para literales provistos por el
usuario; fix del simulador: Condition evalúa la expresión cruda (como el
executor, que convierte templates en variables) en vez de valores inline.

Retro-validación sobre snapshots re6 con el sim corregido: **C-02 2/2 PASS**
(las condiciones del modelo siempre estuvieron bien; era bug del sim).

Medición live re7 (workflow mqu47m0c379zzsu1960c1):
- C-09-b: estructural OK, generación sin retries forzados (la relajación de
  listCrossing funciona: ya no se exige Loop). Pero el modelo eligió un
  patrón "IA compara las listas" (ai-gateway/generate-text recibe ambos
  listados crudos y redacta): la aceptación semántica determinística sigue
  en FAIL (pay_3/ord_7 no aparecen en la salida simulada). Además el body
  del mail embebe JSON crudo con comillas dentro de un config JSON-string
  de composio: rompe el parse (bug genuino, el executor real falla igual).
  Abierto: definir si la reconciliación debe ser determinística (Fórmula/
  Loop) y guiar al modelo hacia eso, o aceptar IA-compara y extender el
  harness para evaluarla.
