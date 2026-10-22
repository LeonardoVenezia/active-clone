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


## Medición live re7-b (deploy a4dd4f6, 2026-10-22 ~12:10 UTC)

- C-02: 0/2 live (re6 con sim corregido: 2/2). Run1: trigger Manual +
  orderId "123456789" hardcodeado + list-shipments inventado + status en
  español ('demorado') que nunca matchea 'delayed'. Run2: Slack dispara
  correcto, pero WhatsApp con texto estático sin tracking. AMBAS runs
  inventan `.raw[0].id` sobre zipnova/list-shipments cuyo output real es
  {shipments: [...]} — gap de metadata de outputFields del step.
- C-09: 0/1 live. La regla de reconciliación determinística cambió la
  estructura (Fórmula, sin AI step), pero el modelo escribió una Fórmula
  ceremonial: expression = "Reconciliación procesada correctamente"
  (constante) e input con `fetch-stripe.count` inexistente. Próxima palanca
  propuesta: regla anti-expresión-constante en Fórmula + metadata de
  outputs (count) en list-payments.
- Sin retries espurios: conditionExpressionError no disparó en ninguna
  generación live (las condiciones del modelo eran sintácticamente válidas).
- Nota de honestidad: el PASS de C-09/re7 (snapshot mqu47m0c) era solo por
  presencia: los ids aparecían via volcado crudo del listado en el cuerpo
  del mail, no por reconciliación computada.


## Medición live re7-c (deploy 6f90175 con levers 1-3, 2026-10-22 ~12:30 UTC)

- **C-02: PASS 4/4 live** (tnl6kz9k3e22une0nr4du): trigger order-created →
  get-shipment (orderId del trigger) → Condition con enum inglés 'delayed'
  → Slack dispara, WhatsApp con ZN-TRACK-123, todos los campos resuelven.
  La metadata de list-shipments + enums visibles en el prompt funcionaron.
- C-09: FAIL live (1bwvgsza2a52hzg35hzat). Estructura determinística
  (2 Loops con Fórmula inner, sin IA), pero las Fórmulas son eco por ítem
  (`paymentId ? amount : 0`): ninguna mira la otra lista; el mail reporta
  counts. La regla anti-ceremonial no lo atrapa (sí referencia sus inputs).
  Además referencia `create-sheet.data` inexistente. Hallazgo: para cruzar
  dos listas hace falta UNA Fórmula con AMBAS listas en el input; el modelo
  tiende a loops paralelos. Posible regla futura: si el prompt pide
  comparar/cruzar/reconciliar, exigir Fórmula con ≥2 refs a outputs de listas.
- C-12: no medible esta corrida — el modelo free devolvió vacío/respuesta
  no usable en 3 intentos seguidos (busy). Sin cambios: 0/2 genuino de re6.
- Tally honesto: C-02 3/5, C-04 1/2, C-05 1/2, C-07 2/2, C-09 0/5, C-12 0/2.

## Medición live re7-d (deploy 562aaea listCrossing v2, 2026-10-22 ~14:30 UTC)

- C-09: FAIL live (opx0evpqmbdtg0u5tbeqg). Por primera vez la estructura es
  la canónica: UNA Fórmula con AMBAS listas en el input y JSONata sintácticamente
  válido (el compile-check con jsonata real atrapó el `$@.` inválido en la
  misma generación y lo corrigió). Pero la expression es una PROYECCIÓN: `stripe`
  (devuelve la lista cruda; pay_3 aparece solo por presencia, ord_7 ausente).
  Hallazgo: la proyección se repitió en 3/3 generaciones con Fórmula 2-listas
  (re5-hw0ycjusgh, re6-j1rq5fxs8dzey, re7-opx0). Nueva regla anti-proyección
  en formulaExpressionError (deploy 95fcf8c): si un input key apunta a un
  output de lista, la expression DEBE usarlo; exige usar ambas listas.
- C-12: FAIL live (91vject1e06fe38oef79e). El modelo generó un GRAFO CÍCLICO
  (create-sheet <-> loops en ambos sentidos): el simulador no ejecuta nada
  aguas abajo del ciclo (0 filas, 0 slack). No existía regla anti-ciclos:
  nueva cyclicFlowError (deploy 018bfe7) que detecta el ciclo y nombra las
  aristas a quitar; el corrective pass recibe el detalle.
- Tests de reglas ahora versionados en evals/semantic/tests/ (rules2-5).
- Tally honesto: C-02 3/5, C-04 1/2, C-05 1/2, C-07 2/2, C-09 0/5, C-12 0/2.
  (Sin cambios de tally: las dos corridas nuevas son FAIL genuinos; las reglas
  nuevas aún no tuvieron retry live.)

## Medición live re8 (deploy 018bfe7 con anti-proyección + cyclicFlowError, 2026-10-22 ~14:53 UTC)

- C-09: FAIL live (38xmvyn4cywwbeg4isxga). Estructura canónica y sin errores
  (1 sheet row, 1 mail, todos los campos resuelven), pero el modelo ESQUIVÓ la
  regla anti-proyección en una generación: el input de la Fórmula ahora referencia
  `.count` de cada lista y la expression es `stripe - tiendanube` (resta de
  conteos): usa ambos inputs formalmente pero no cruza ningún ítem. pay_3 y
  ord_7 ausentes. Patrón confirmado: cada regla nueva produce una forma fake
  nueva (constante -> eco -> proyección -> resta de counts). Próxima palanca:
  en el cruce, las keys del input deben apuntar al output ARRAY de la lista
  (payments/orders), no a escalares (count/hasMore/total).
- Tally honesto sin cambios: C-02 3/5, C-04 1/2, C-05 1/2, C-07 2/2, C-09 0/5, C-12 0/2.

## Medición live re9 (deploy 97ef03e con array-binding, 2026-10-22 ~15:20 UTC)

- C-09: FAIL (v5o24mdtv4ui97xlkebqt), 2/3 checks. El array-binding funcionó:
  el input de la Fórmula ahora referencia `.payments` y `.orders` (arrays).
  Pero la expression volvió a la proyección `stripe` — la regla anti-proyección
  la RECHAZA (tiendanube sin usar), sólo que la ola busy del modelo free
  dejó el corrective pass sin respuestas (2 reintentos, empty) y la app
  publicó el flujo con el error sin corregir. pay_3 aparece sólo por presencia
  (volcado crudo), ord_7 ausente. Hallazgo estructural: el validador atrapa
  la forma, pero el pipeline la deja pasar cuando el corrective pass no puede
  ejecutarse — no es un gap de regla, es de resiliencia del pipeline.
- Tally honesto sin cambios: C-02 3/5, C-04 1/2, C-05 1/2, C-07 2/2, C-09 0/5, C-12 0/2.

## Medición live re9-final (mismo deploy 97ef03e, 2026-10-22 ~17:30 UTC)

- C-09: FAIL confirmado en re-medición limpia (mismo workflow v5o24mdtv4ui97xlkebqt,
  2/3: pay_3 sólo por presencia, ord_7 ausente). Con el modelo ya responsivo el
  builder completó la configuración pendiente (recipient_email) en un pass
  posterior, pero la proyección `stripe` de la Fórmula quedó publicada: el
  corrective pass no la reparó aunque la regla anti-proyección la rechaza
  (verificado en tests). Conclusión del ciclo: las reglas atrapan todas las
  formas fake observadas, pero el pipeline publica igual cuando el corrective
  no corre o no logra reparar. Se agota el cupo de 2 ciclos tighten-and-measure.
- Tally honesto final: C-02 3/5, C-04 1/2, C-05 1/2, C-07 2/2, C-09 0/5, C-12 0/2.

## Medición live re10 (deploy f22f341, template reconcile mandatorio, 2026-10-22 ~17:45 UTC)

- C-09: FAIL (workflow 9t6d2gx95su5dx80p1yzn, 1/3 checks). Primer build fresco
  post-template: el modelo ignoró el mandato del template y produjo una Fórmula
  "Resumen de Cobros y Órdenes" de conteo:
  `"Stripe total: " & stripe_count & " | Tiendanube total: " & tiendanube_count`
  con input ligado a `...payments.count` y `...orders.count` (agregados, no
  ítems). Ni pay_3 ni ord_7 llegan a sheet/email. Sexta forma fake distinta:
  count-summary a pesar del template mandatorio en prompt. El template pasa en
  sim (snapshot de referencia) pero el modelo live no lo adopta cuando decide
  "resumir" en vez de "cruzar". Config pass posterior (con Reintentar) tampoco
  lo corrigió.
- Tally honesto: C-02 3/5, C-04 1/2, C-05 1/2, C-07 2/2, C-09 0/6, C-12 0/2.
- CAVEAT (17:58 UTC): el deploy de Vercel de bc8dc8d (17:47 UTC) seguía SIN
  servirse a las 17:58 UTC (>10 min). Si f22f341 (17:40 UTC) tardó parecido,
  los builds de las 17:44-17:46 corrieron contra código PRE-template y la
  conclusión "el modelo ignoró el template" queda invalidada: re10 mediría el
  comportamiento viejo. Se re-mide C-09 apenas se confirme el deploy live
  (chunk-scan "Importar plantilla" como marca del bundle nuevo).
