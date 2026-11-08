# Arquitectura: soluciones cerradas configurables y frontend por solución

Estado actual (8-nov-2026 17:16): **base implementada y verificada en rama/preview; frontend dedicado de cada solución todavía pendiente**. No merge ni producción. Las secciones iniciales conservan el diagnóstico y propuesta originales; la implementación y los límites vigentes están en la bitácora y en el cierre de incremento al final. Estado operativo en Trello: https://trello.com/c/lnebGtju .

## 1. Decisiones adoptadas (de Leo, 8-nov-2026)

1. **El usuario ve una herramienta para su caso, no el lienzo.** Si ofrecemos
   workflows cerrados, cada uno necesita un buen frontend propio, con gran
   capacidad de customización por diseño.
2. **Una fuente no configurada no se consulta ni se espera.** Si un workflow
   puede recibir un dato de cuatro fuentes (TN, ML, Amazon u otras) pero el
   cliente usa una sola, el proceso no puede tener delays ni salir a buscar
   datos a plataformas que no están configuradas.
3. **Las decisiones de diseño son persistentes y documentadas** (en el
   proyecto y Trello), no se pierden en el chat.
4. **El lienzo manual sigue disponible.** La solución cerrada es una capa
   encima; el editor de workflows actual no desaparece.

## 2. Estado real hoy (verificado en código, branch pack-conciliar-pagos)

- **Frontend genérico único por workflow.** El nodo Frontend define UNA página
  (`/frontend/<id>`): título, UNA colección de Datos, columnas/labels
  opcionales, formulario opcional, botón Ejecutar. La página pide datos cada 5
  segundos (polling). Ver `lib/datos/frontend.ts` (`FrontendView`,
  `MAX_COLUMNS = 12`), `components/frontend-panel.tsx`,
  `app/frontend/[workflowId]/page.tsx`. No existe noción de "solución" ni de
  vistas distintas por caso.
- **Las fuentes son plugins por plataforma** (`plugins/tiendanube`,
  `plugins/mercadolibre`, `plugins/stripe`, etc.), cada uno con triggers y
  actions. No existe plugin de Amazon hoy.
- **Un paso que llama a una fuente sin credenciales FALLA la corrida**
  (`NOT_CONFIGURED_ERROR`, ej. `plugins/tiendanube/steps/search-orders.ts`).
  No hay gateo por "fuente activa/inactiva": si el paso está en el grafo, se
  ejecuta (y falla, o espera reintentos según configuración).
- **Los pasos del pack ecommerce son agnósticos de plataforma**: leen eventos
  de colecciones de Datos y escriben reportes en Datos
  (`lib/steps/postpurchase-notices.ts`, `stock-alerts.ts`,
  `payment-reconcile.ts`, `shipment-review.ts`, `support-assist.ts`). La
  ingesta real desde cada plataforma es la pieza que falta conectar.
- Existen variables por empresa (company variables) pero con policy flag
  (`COMPANY_VARIABLES_POLICY_APPROVED`) — aún no habilitadas.

## 3. Propuesta de arquitectura

### 3.1 Concepto: Solución

Una **Solución** es un paquete cerrado y versionado en el repo que declara:

- el/los workflows que la implementan;
- el **esquema de configuración por cliente**: fuentes posibles (con cuáles
  están activas), parámetros (umbrales, textos, políticas), destinos;
- la **definición del frontend** (vista dedicada, ver 3.4);
- los estados visibles de falta de configuración o de fallo (ver 3.5).

### 3.2 Configuración por cliente

Por organización (cliente) y solución se guarda:

- **fuentes activas**: subconjunto de las fuentes declaradas por la solución.
  Ej.: la solución "avisos postcompra" declara TN + ML (+ futuras); el cliente
  activa sólo TN;
- **parámetros**: umbrales, textos de borradores, políticas de derivación;
- **destinos**: canal de avisos, responsables de aprobación.

Almacenamiento **adoptado (8-nov, decisión técnica T1)**: la config se declara
en un nodo `Solución` del propio workflow (campos de texto: `solutionName`,
`sources` como pares `fuente=active|inactive`, y los slots de diseño
`brand`/`subheading`/`accent`/`emptyText`). Vive en `workflows.nodes`, por lo
tanto: sin migraciones de base de datos (preview y prod comparten DB y no hay
autoridad para migrarla), versionada con el flujo, editable en el lienzo y
reversible. Motivo del cambio respecto de la propuesta original (entidad
dedicada): una columna/tabla nueva exigiría migrar la DB compartida, fuera de
los permisos actuales. Cuando haya autoridad para migrar, se puede migrar el
formato a una entidad dedicada sin cambiar el contrato.

### 3.3 Ejecución sólo con fuentes activas (decisión adoptada #2, cómo)

- La solución declara sus fuentes posibles. En cada corrida, lo primero que se
  resuelve es la config del cliente: **sólo se ejecutan las ramas de fuentes
  activas**.
- Fuente inactiva = **omitida registrada**: aparece en el reporte como "no
  configurada / omitida", nunca como error, sin consulta HTTP, sin espera ni
  reintento.
- Fuente activa pero sin credenciales o caída = **fallo visible** (ver 3.5):
  es un estado distinto de "inactiva" y debe mostrarse como algo a resolver.
- Esto requiere AGREGAR el gateo por config antes de los pasos de ingesta
  (hoy no existe; hoy el paso se ejecuta y falla con NOT_CONFIGURED). Es la
  pieza de código nueva central de esta arquitectura.

### 3.4 Frontend por solución

- Cada solución define su **vista dedicada**: layout, secciones, columnas,
  textos, acciones (ejecutar, aprobar, configurar). No es la tabla genérica
  actual.
- **Customización por diseño = slots declarativos**, no código libre por
  cliente: título, secciones visibles, columnas y labels, textos de estados
  vacíos/error, branding básico. Los slots se definen en la solución y el
  cliente los ajusta dentro de esos límites. **Decisión abierta D2** (nivel de
  customización permitido).
- El panel genérico actual (`FrontendView`) queda como fallback para workflows
  sin solución, y el lienzo sigue para armado manual (decisión adoptada #4).

### 3.5 Estados visibles en el frontend

El frontend de cada solución debe distinguir y mostrar:

1. **Fuente no configurada** (inactiva): invitación a configurarla, no error.
2. **Fuente activa con problema** (credenciales inválidas, API caída): aviso
   claro de qué resolver.
3. **Sin datos todavía**: estado vacío honesto.
4. **Borradores/resultados**: con sus marcas fieles ("Ya preparado",
   "Derivación registrada", nunca implicar enviado).

### 3.6 Agregar una fuente nueva

Agregar una fuente (ej. Amazon en el futuro — **hoy no existe como plugin**)
= crear el plugin + declararla como fuente posible en la solución + su
sección de config. Las soluciones que no la declaren no se tocan.

### 3.7 Customización estructural por caso (más allá de los slots)

El encargo pide "gran capacidad de customización por diseño": que cada caso
(cliente + problema) tenga un frontend distinto y útil, no sólo cambios de
color. La arquitectura separa tres niveles:

**Nivel 1 — Slots cosméticos (IMPLEMENTADO).** `brand`, `subheading`,
`accent`, `emptyText` por solución. Sanitizados en servidor. Cubre identidad
básica; no cambia la estructura.

**Nivel 2 — Estructura declarativa por solución (IMPLEMENTADO en parte).**
La vista de cada solución se compone de bloques que la config enciende,
apaga y parametriza, sin código por cliente:

- `showRun` / `runOnSubmit`: si el caso expone ejecución manual y cuándo.
- `showForm` + `fields` (tipados: texto, número, booleano, fecha, con
  requeridos): el formulario del caso, distinto por solución.
- `columns` + `labels`: qué columnas del reporte ve el cliente y con qué
  nombre.
- `rowsField`: modo reporte (un registro = una tabla fresca por run, sin
  filas viejas acumuladas).
- `keyField`: cómo se deduplica/actualiza cada fila.
- Sección **Fuentes** (45208e3 + 1c8a58a): bloque estructural nuevo, no un
  slot: surge de las fuentes declaradas y muestra estado y fecha reales.

Lo que falta de este nivel (PROPUESTO, no implementado):

- **Orden y composición de bloques** declarados en la config (hoy el orden
  es fijo en el componente).
- **Visibilidad condicional** de bloques (ej. mostrar el formulario sólo si
  hay borrador pendiente).
- **Acciones por caso** más allá de ejecutar/enviar formulario: aprobar,
  derivar, marcar revisado (hoy no existen).
- **Varios paneles por solución** (ej. uno operativo para el cliente y uno
  de control para Leo).

**Nivel 3 — Layout libre por cliente (DESCARTADO por ahora).** HTML/layout
arbitrario por cliente rompe la mantenibilidad del pack: cada caso sería
código a medida. La puerta queda en el Nivel 2 ampliable: agregar un bloque
o parámetro nuevo NO rompe las soluciones existentes (defaults defensivos,
testeado en `solution-config.test.ts`).

**Ejemplo concreto del pack (caso QA real):** la solución "conciliación de
pagos" para el cliente Distribuidora Andina declara tres fuentes
(Tiendanube activa, Stripe activa, Mercado Libre desactivada por decisión
del caso). Su panel muestra: encabezado con marca, estado de cada fuente
con fecha de última consulta, el reporte de conciliación en modo `rowsField`
(tabla fresca por run) y el formulario de ajuste manual con los campos de
ese caso. Otro cliente con el mismo pack pero sólo Mercado Libre activa
recibe la MISMA solución con otra config: distintas fuentes visibles,
distintas columnas y textos, sin un fork de código. Eso es la customización
estructural: la estructura visible deriva de la config persistida en el
nodo `Solución`, no de ramas de código por cliente.

**Experiencia persistente:** la config vive en el workflow (persistida con
él), las decisiones en este doc + la card Trello, y el frontend siempre
refleja la config actual: cambiar la solución cambia el panel sin deploy.

## 4. Decisiones técnicas adoptadas (delegadas por Leo, 8-nov 14:05)

Leo delega diseño/UI/UX y decisiones técnicas sin costo; sólo se le escala un
tradeoff de producto realmente irresoluble. Con ese criterio:

- **T1 (ex D1)**: la config por cliente se declara en un nodo `Solución` del
  propio workflow. Fundamento: preview y prod comparten base de datos y las
  migraciones sólo corren en builds de producción (`scripts/migrate-prod.ts`);
  una columna/tabla nueva queda fuera de los permisos actuales. El formato es
  portable a una entidad dedicada cuando corresponda. Implementado en
  `lib/soluciones/config.ts` (`solutionConfigFromNodes`).
- **T2 (ex D2)**: slots declarativos acotados para el diseño
  (`brand`, `subheading`, `accent`, `emptyText`). Fundamento: customización
  visible sin layouts libres que rompan el frontend genérico; ampliable con
  nuevos slots sin tocar el contrato. Implementado en `/api/datos` +
  `components/frontend-panel.tsx`.
- **T3 (ex D3)**: por ahora las soluciones las arma un admin por cliente (son
  workflows con un nodo `Solución`); el catálogo instalable queda como
  evolución posterior, sin bloquear el modelo.
- **T4 (ex D4)**: multi-idioma/moneda, después. Los textos de los slots ya son
  por cliente, así que la puerta queda abierta.

Ninguna cambia lo acordado con Leo en la sección 1; si una revisión suya pide
otra cosa, este registro se corrige con fecha.

## 5. Registro de decisiones

Las decisiones adoptadas se agregan a la sección 1 (origen Leo) o a la sección
4 (técnicas delegadas) con fecha y origen. Este archivo es el registro
persistente; Trello linkea acá.

### 8-nov-2026: primera implementación (rama `soluciones-configurables`)

- Ejecutor: paso de fuente explícitamente inactiva = omitido REGISTRADO en el
  log del run (`solutionOmittedStep`), sin consulta, sin espera y sin error;
  se entrega como rama inactiva (misma semántica que una condición falsa):
  los consumidores en cadena se saltan y `Unir` la lista aparte en `omitted`.
- Una fuente ACTIVA sin credencial sigue fallando visible
  (`NOT_CONFIGURED_ERROR`): jamás se omite en silencio.
- Disparadores de integración inactivos: misma omisión registrada.
- El nodo `Solución` se ejecuta como no-op (declara, no actúa).
- Contratos cubiertos por tests (`tests/workflows/solution-config.test.ts`,
  8 tests dentro del gate CI del pack):
  parse defensivo, identificación de fuente por paso, inactividad explícita
  vs. activa vs. no declarada, contrato de ausencia, config desde nodos.
- Validación end-to-end en preview (cuenta QA aislada, 8-nov-2026):
  - **Fan-in mixto** (run `rqj3eoztb4e5ytteqzs4z`, workflow fixture
    `ma94hwgh9i9k74bpl4prx`): rama activa con éxito (`Fórmula`), rama activa
    sin credencial (`stripe/get-payment`) y rama inactiva
    (`tiendanube/search-orders`). Resultado: la inactiva quedó registrada en
    el log como "Pedidos TN (omitido por solución)" con el motivo y el
    marcador `__solutionOmitted`, sin consulta al proveedor; la activa sin
    credencial falló visible (`STRIPE_SECRET_KEY is not configured`); `Unir`
    corrió con `completed=[Ventas QA]`, `failed=[Pago Stripe]`,
    `omitted=[Pedidos TN]`; el consumidor posterior recibió la salida del
    `Unir` (incluida la lista de omitidos) y terminó OK.
  - **Todas inactivas** (run `tbz9e5ba0h4rq8de4l8pc`, workflow
    `0obnr3o08qv133akaf77v`): dos fuentes declaradas inactivas. Resultado:
    ambas omitidas y registradas, `Unir` y el consumidor nunca corrieron, el
    run terminó en éxito sin errores y sin esperas.
  - **Rama activa con error** (run `b2f1yjufqtuhb9bhx1qc2`): `Unir` lista el
    fallo aparte de los omitidos y propaga el error visible.
  - Hallazgo QA sin impacto en el diseño: la integración Mercado Libre de la
    cuenta QA figura en el listado pero no tiene tokens guardados, así que
    sus pasos responden "not connected" (fallo visible correcto, no
    relacionado con el gating). La rama activa con éxito se demostró con
    `Fórmula` (paso sin credenciales).
  - Evidencia visual: capturas del canvas y del panel Ejecuciones de ambos
    fixtures (adjuntas al reporte del encargo).

### 8-nov-2026: frontend por solución con estados de fuente (commit 45208e3)

- El panel del cliente (`/frontend/[workflowId]`) muestra una sección
  "Fuentes de esta solución" con cuatro estados distinguibles por fuente:
  **Consulta exitosa** (con la fecha de esa consulta; renombrado desde
  "Al día" para no prometer frescura por un éxito pasado), **Error** (activa con fallo, p.ej.
  credencial faltante, con el detalle redactado), **Sin datos todavía**
  (activa sin consulta en el último run) y **Desactivada** (decisión de la
  solución, explicada siempre). Cuando TODAS las fuentes están desactivadas,
  el panel lo dice explícitamente ("esto es una configuración, no un
  error"): nunca un vacío que parezca éxito.
- Cálculo en servidor (`/api/datos`): config del nodo "Solución" + logs del
  último run del workflow (`nodeType` = actionType ⇒ integración). Nombres
  visibles desde el registro de plugins. Implementación pura en
  `lib/soluciones/fuentes-view.ts` con 8 tests
  (`tests/workflows/fuentes-view.test.ts`).
- Validación visual: render SSR del componente real `FrontendPanel` con
  fixtures + CSS Tailwind real de la app, inspeccionado en browser a 1280px
  y 390px (capturas adjuntas al reporte). El panel EN VIVO no se puede
  demostrar en el preview de la rama porque `DATOS_STORAGE_ENABLED` está
  apagado para previews (`/api/datos` responde `enabled:false`); habilitarlo
  es un cambio de env en Vercel (cuenta de Leo), pendiente de su OK si se
  quiere la demo en vivo antes de mergear. No requiere migración ni toca
  producción.
- Alcance honesto: la rama activa con éxito E2E se demostró con `Fórmula`,
  no con un conector real; triggers de integración omitidos validados sólo
  por tests unitarios, no E2E.

### 8-nov-2026: frescura visible y copy de cliente (commit 1c8a58a)

- Cada fuente consultada muestra la **fecha real de su última consulta**
  (formato es-AR). La fecha sale del timestamp del log del último run
  (`/api/datos` lo propaga como `at` ISO por outcome).
- Chip renombrado: **"Consulta exitosa"** (antes "Al día") con detalle
  "Datos de la última consulta <fecha>": un éxito pasado con fecha no
  garantiza frescura actual, y el estado nunca lo sugiere.
- Errores de configuración con **copy para el cliente**: "Falta conectar
  Stripe." en lugar del mensaje crudo interno (`STRIPE_SECRET_KEY is not
  configured`); el detalle interno queda para la vista Sistema. Regla:
  nunca nombres internos (variables de entorno, claves) en la vista del
  cliente.
- Texto de fuentes omitidas acotado a la configuración (sin hablar de
  "borradores" en fuentes).
- Fixture de demostración con subtítulos sin promesas de frescura ("Tus
  fuentes y precios en un solo lugar."), re-verificado visualmente en
  desktop y mobile.
- Nueva sección 3.7: customización estructural por caso (niveles,
  implementado vs. propuesto, ejemplo concreto del pack).

### 8-nov-2026: demo EN VIVO del panel con flag habilitado (preview de la rama)

- Leo autorizó (8-nov 15:22, alcance puntual) habilitar
  `DATOS_STORAGE_ENABLED=true` sólo para Preview/branch
  `soluciones-configurables` + redeploy, con datos ficticios QA, sin tocar
  producción ni esquema. Se aplicó exactamente ese alcance: variable tipo
  Secret con scope Preview branch-only (Production desmarcado; el patrón
  branch-scoped ya existía en el proyecto para otras dos ramas). Redeploy
  del commit 9f57895 → deployment 6qczQUTT Ready.
- **Fixture con empresa:** el fixture `ma94hwgh9i9k74bpl4prx` no tenía
  empresa asignada y la app no permite asignarla post-creación (el scope
  org se inserta sólo en `POST /api/workflows/create`; el PATCH de
  workflows ignora `organizationId`). Se creó la copia
  `8xguveq6eijfwi7rj4rsp` en la org QA "nueva empresa" con los mismos
  nodos/edges + un nodo Frontend (`qa_solucion_panel`). El fixture
  original quedó intacto (snapshot verificado por GET).
- **Verificación en vivo** (sesión QA owner de la org, preview
  `active-clone-61ad0bjvs-...vercel.app`):
  - `/api/datos?workflowId=...` responde `enabled:true` con view, slots de
    la Solución, fields y records (antes: `enabled:false`).
  - Panel del ejemplo de catálogo (`t22rymy9ank9n8ulb63qr`): formulario +
    registros reales con fecha de actualización.
  - Panel de la solución QA con **Ejecutar real** desde el botón del
    panel: Stripe pasó de "Sin datos todavía" a "Error · Falta conectar
    Stripe · 8/11/26, 3:35 p. m." (copy cliente + fecha real del log);
    Tiendanube quedó "Desactivada en la configuración de esta solución:
    no se consulta". Comprobado en vivo: la fuente inactiva nunca se
    consulta, ni siquiera en un run real; la activa sin credencial se
    distingue de la inactiva en la vista del cliente.
  - Slots de diseño del nodo Solución aplicados al panel vivo (marca,
    acento, subtítulo, emptyText). Capturas desktop y mobile en el
    reporte a main (8-nov 15:36).
- La cuenta QA aislada (grn0ar+clone-qa1) no es miembro de la org QA:
  403 correcto ("Sin acceso a los datos de esta empresa").

## 3.8 Sistema visual del panel (8-nov, Impeccable)

Revisión visual pedida por Leo (audio 15:45) aplicando la guía Impeccable. El sistema completo (paleta con el porqué de cada color, tipografía, estados, movimiento, alcance) quedó definido en `DESIGN.md` en la raíz del repo; todo el color vive en variables CSS en `app/globals.css` (editable en un solo lugar). Regla central: el petróleo (200°) es identidad/acción primaria y el resto del color siempre significa estado (éxito/atención/error); carga con skeleton, vacíos que enseñan, foco y selección teñidos de marca. Alcance: panel del cliente; el builder conserva el tema neutro (extensión pendiente). Verificado renderizado en desktop y móvil sobre el preview.

### Bitácora 8-nov (tarde): sistema visual + guía manual

- Revisión visual del panel con la guía Impeccable: sistema definido en `DESIGN.md` (commits 295e274 y 006f992). Coherencia de superficie: /frontend ya no muestra el header del backoffice ni nombres internos (slug de colección); labels de la config aplicados también al formulario; copy del indicador de refresco aclarado (vista, no proveedor); reduced-motion respetado; modo oscuro verificado.
- Guía manual completa por recorridos del cliente (File PRIVATE): https://files.instinct.com/ljprore922eg-guia-de-active-clone-por-recorridos — Parte 1 cliente (7 recorridos), Parte 2 configuración manual de Leo (8), Parte 3 pruebas internas. Refleja la app real al 8-nov; actualizarla cuando se integren bloques/acciones por caso.
- Pendiente vivo: bloques ordenados + acciones por caso (trabajo en curso, no descartado).

### Bitácora 8-nov (noche): bloques/acciones por caso + preparación de pruebas de integraciones

**Bloques y acciones por caso (commit d885231).** El nodo Frontend acepta dos configs nuevas: `blocks` (orden/composición del contenido: `tabla, formulario, fuentes`; claves desconocidas se ignoran y vacío cae al orden original, así los paneles existentes no cambian sin config explícita) y `actions` (acciones por fila declaradas por el caso: `aprobar=Aprobar, derivar=Derivar a soporte`; cada una escribe `actionField=<id>` - default `estado` - sobre el registro, sin correr workflows). Ruta nueva `POST /api/frontend/<id>/action` con decisiones solo en servidor (sesión, owner/share, scope y membresía de empresa, mismo origen, acción declarada en la config del servidor). La tabla de registros gana columna "Acciones"; el modo reporte (rowsField) queda solo lectura a propósito (sus filas no son registros). Tests nuevos en `tests/workflows/frontend-blocks-actions.test.ts` (7 casos; 26/26 verdes en el directorio; tsc y ultracite limpios en los archivos tocados). Deuda de estilo preexistente de `lib/datos/frontend.ts` corregida en el mismo commit (obligada por el gate de lint del PR). Pendiente: incorporar la versión final a la guía de recorridos (los 5 paneles demo siguen sin acciones; mostrarlo con un caso cuando Leo elija).

**Preparación de pruebas funcionales de integraciones (sin conectar cuentas ni ejecutar efectos).** Relevamiento del registry de plugins y sus `test.ts` (validación read-only de credenciales ya existente por integración). Mapa de pasos disponibles (lectura vs escritura) para elegir recorridos seguros:

- Stock: tiendanube (get-product, list-products / update-stock es escritura), mercadolibre (get-item, list-items, stock-snapshot / update-item escritura), vtex (get-order, list-orders).
- Envíos: correoargentino (get-rates, list-agencies / import-shipment escritura), zipnova y enviopack (get-tracking, get-shipment, get-rates / create/cancel escritura).
- Conciliación: stripe (get-payment, list-payments; admite claves sk_test_ y su test.ts valida con /balance read-only), mercadopago (get-payment, search-payments / refund escritura).
- Avisos: resend (send-email es escritura; get-email lectura de estado), whatsapp (send-* escritura; list-templates lectura).

Propuesta de criterio para los recorridos funcionales (a definir con Leo antes de ejecutar): 1) solo pasos de LECTURA sobre cuentas de prueba (Stripe test mode / sk_test_, MP test users, tienda demo), nunca create/update/send/refund/cancel; 2) la conexión se crea en la empresa QA con credenciales de prueba y se declara como fuente activa en una solución fixture, para ver el contraste real: desactivada = nunca se consulta, activa sin conectar = falla visible, activa conectada = datos reales de la cuenta de prueba en el panel; 3) la "prueba de conexión" (test.ts del plugin) es el primer recorrido por integración porque ya es read-only por diseño. Decisión pendiente de Leo: qué proveedor(s) tiene cuenta de prueba disponible (Stripe test, MP test users, tienda Tiendanube demo o de desarrollo). Sin esa cuenta no hay prueba funcional real posible; con ella, cada recorrido se escribe en la guía con precondiciones, clics y esperado antes de ejecutarse.

### 8-nov (noche, segunda parte): fixture acciones + investigación de credenciales

- **Fixture nuevo**: workflow "QA gestión de casos acciones fixture 8nov" (`idy9jj6ngts5gz24idn2d`, org QA, colección `qa_fixture_casos`, 3 registros pendientes). Frontend con `actions` aprobar/derivar/descartar sobre `actionField` estado; Ejecutar re-siembra los 3 registros. Verificado: desktop sin scroll (7 columnas), acción real aplicada (Derivar → estado "derivar", otras filas intactas), 401/403 sin sesión, regresión visual en paneles stock y catálogo, móvil con scroll horizontal a la columna Acciones.
- **Credenciales de test disponibles (solo lectura, sin conectar)**:
  - Org QA ya tiene 4 conexiones: 3 Mercado Pago + 1 Mercado Libre (cuenta 210308243, ML actualizada 7-nov). Pasos de lectura disponibles: ML list-items/get-item/search-orders/get-shipment/get-question; MP search-payments/get-payment/search-customers/list-cards.
  - Vault: "Mercado Pago Access Token (prueba)" (token de test), "Zipnova API (Leonardo)" y "Enviopack API (Leonardo)" (cuentas creadas 10-18 a pedido de Leo para probar estos nodos; Zipnova sin saldo → solo quotes; Envíopack balance $0 → read-only y borradores). Ninguna está conectada todavía en la org QA.
  - Vault: "Active-clone COMPOSIO_API_KEY" existe, pero el preview no la tiene como env var (`/api/connectors` → 503 "Integrations are not configured on the server"); agregarla como env var Preview habilita el catálogo.
  - **Gap real**: Stripe — no hay clave de prueba (`sk_test_`) disponible en vault ni en el repo; el plugin la acepta y la valida con GET /balance (solo lectura).
- Recomendación: prueba funcional segura = conexiones de solo lectura en org QA con las credenciales de test ya existentes (MP token de prueba, Zipnova quotes, Envíopack read-only) + lecturas ML con la conexión existente; escrituras/dinero quedan fuera hasta OK explícito (decisión 10-17/10-20).

### 8-nov (noche, tercera parte): pruebas funcionales de integraciones — autoridad y diagnóstico

- **Autoridad verificada en originales (phone_messages, canal WhatsApp DM verificado +5491134995863):**
  - ML 7-nov 14:43 (agent, alcance: lectura catálogo — publicaciones/variantes/SKU/stock — con conexión guardada, sin cambios ni mensajes) → Leo 14:44 "todo lo que quieras y necesites" (wamid.HBgNNTQ5MTEzNDk5NTg2MxUCABIYFjNFQjA1ODhBQzkzNDNDMjY2RTA5NzEA). Cubre SOLO lectura de catálogo ML vía conexión existente; pedidos/envíos/mensajes NO cubiertos.
  - Logística 17-oct 23:35 (agent: cotizar, sucursales, listar, seguimiento, sin crear nada, con cuentas test) → Leo proveyó datos 18-oct 00:15 y "Adelante." 00:56. Zipnova sin saldo (solo cotización), Envíopack balance $0 (read-only/borradores). Crear/cancelar envíos reales requiere OK aparte.
  - MP: sin autorización registrada para usar las conexiones guardadas. Excluido.
- **Diagnóstico preview (todas lecturas/probes sin efectos):** `/api/connectors` → 503 (falta COMPOSIO_API_KEY); `/api/integrations/mercadolibre/install` → 503 (faltan MERCADOLIBRE_APP_ID/SECRET); POST /api/integrations → 500 "INTEGRATION_ENCRYPTION_KEY environment variable is required"; las 4 conexiones existentes (3 MP + 1 ML) devuelven config vacío en preview porque decrypt falla sin la key (decryptConfig captura y devuelve {}). Conclusión: el preview no puede desencriptar conexiones existentes ni crear nuevas ni hacer OAuth.
- **Fix aplicado:** INTEGRATION_ENCRYPTION_KEY cargada en Vercel para Preview rama soluciones-configurables (Production DESMARCADO), valor desde vault "Active-clone STAGING INTEGRATION_ENCRYPTION_KEY" vía vault fill (valor nunca leído ni registrado). Requiere redeploy para tomar efecto; si la key STAGING no coincide con la que cifró las conexiones existentes, las nuevas conexiones manuales (Zipnova/Envíopack) igual funcionan y las viejas seguirán ilegibles en preview.
- Nota de seguridad observada: GET /api/integrations/[id] devuelve el config desencriptado completo al usuario dueño de la sesión. Documentado para revisión; fuera de alcance de esta rama.
- Primer intento ML stock-snapshot (workflow 075mn0xkewkzxqibshq65, ejecución xqivop00p3chfi44vqy1g): error esperado "Mercado Libre is not connected" por la key faltante; reintentar tras redeploy.

### 8-nov (noche, cuarta parte): env vars del preview aplicadas y estado de pruebas

- INTEGRATION_ENCRYPTION_KEY (Preview, rama soluciones-configurables) y COMPOSIO_API_KEY (idem) cargadas en Vercel vía vault fill, Production desmarcado. Redeploy por push.
- Verificado en vivo: POST/GET/DELETE de conexión dummy round-trip OK (cifrado operativo); /api/connectors 200 con catálogo Composio; /connections muestra apps nativas (Envíopack visible con formulario manual).
- Las 4 conexiones preexistentes (3 MP + 1 ML, cifradas con otra key) siguen sin desencriptar en el preview: legibles solo donde viva la key original. No se tocaron.
- ML: bloqueado en preview por doble vía — conexión existente ilegible (key distinta) y OAuth no disponible (faltan MERCADOLIBRE_APP_ID/SECRET en el entorno Preview; no están en el vault). Gap exacto: esas dos env vars, o correr la lectura autorizada (7-nov) donde la key original exista.
- Envíopack: formulario de conexión abierto, API Key cargada (username vault, sin restricción), Secret Key bloqueada por restricción de sitio del vault (entry limitada a enviopack.com/.ar): requiere aprobación del usuario (approval_url generada, en manos del orquestador). Sin submit parcial.
  - **Aislamiento de la conexión nueva (cuando se apruebe el fill):** se crea SOLO en la org QA del preview (nombre claramente QA, p.ej. "Envíopack QA preview"), cifrada con la key del entorno preview de la rama — no toca ni lee conexiones existentes ni prod. Alcance: solo lectura/cotización (list-branches/cotización), sin cargos, envíos ni mensajes (balance $0 → read-only/borradores según autorización 17-oct).
- Zipnova: queda para después (3 campos; account ID no está claramente en el vault).
- MP: excluido por instrucción (sin autorización registrada).

### 8-nov (noche, quinta parte): verificación de regresión y diagnóstico ML pendiente de prueba crypto

- **Sin regresión:** las 4 conexiones originales intactas (3 MP + 1 ML), mismos updatedAt (MP 16/17-oct, ML 7-nov 17:48 UTC), sin registros nuevos (dummy probe borrado, DELETE 200). Cambios de env vars acotados a Preview rama soluciones-configurables; la entrada Production de INTEGRATION_ENCRYPTION_KEY (9-oct) intacta; otras ramas preview sin tocar. No se rotó ni re-encriptó nada.
- **Diagnóstico ML (sin mutar):** la conexión ML t45q1qi6vkrwbfxtwx53c tiene updatedAt 7-nov 17:48 UTC = 14:48 -03, exactamente la prueba de lectura autorizada que SÍ funcionó ese día; el registro no se modificó desde entonces. La metadata indica que no hubo cambios registrados desde esa prueba; no prueba el contenido actual de tokens ni la causa criptográfica. El config vacío del preview es consistente con un fallo de decrypt por clave distinta, pero también puede resultar de clave ausente o dato dañado; no se debe sobrescribir en ninguno de esos casos. Ruta de lectura existente sin mutar: correr donde viva la key original (prod). Sin cambios de OAuth/seguridad.
- **Guard anti re-cifrado cruzado (b8609b3, reforzado 7dac6b0):** `updateIntegration` y `deleteIntegration` toman lock de la fila del dueño dentro de la transacción, validan descifrado y JSON objeto antes de cualquier write. Si no se lee, bloquean todos los cambios (incluido nombre) y borrado; PUT/DELETE responden 409 claro sin afirmar una causa criptográfica no probada. Reconnect valida al preparar, antes de cualquier intercambio OAuth y nuevamente bajo lock antes de escribir; AI Gateway rechaza revocación/borrado si config no se lee. La UI muestra aviso y deshabilita editar/probar/borrar al abrir una conexión ilegible; error API también se muestra. Se retiró el override de lint inicial y se corrigió el legacy tocado. 32/32 tests workflows, tsc y lint limpios; fixture en memoria ejecuta funciones update/delete reales contra claves ficticias sin DB externa, comprueba cero writes al rechazar y lock antes de validar.
- **Zipnova:** sus pasos exigen los 3 campos (ZIPNOVA_API_TOKEN + ZIPNOVA_API_SECRET + ZIPNOVA_ACCOUNT_ID, api.ts:11 y test.ts). El vault "Zipnova API (Leonardo)" tiene solo 2 subcampos (username+password); el account ID vive en el dashboard (Configuración > Integraciones). app.zipnova.com y app.zipnova.app inalcanzables desde el navegador cloud (proxy provider_unreachable; www.zipnova.com sí carga). Además su fill en el preview requeriría aprobación de sitio propia (entry limitada a zipnova.com/.ar), igual que Envíopack.
- Riesgo residual declarado: si alguien EDITA una conexión existente desde este preview, su config se re-encriptaría con la key STAGING y dejaría de ser legible donde viva la key original. Mitigación operativa: no editar conexiones existentes desde el preview (solo crear nuevas de prueba).


### 8-nov 17:10 - cierre guard y lectura Envíopack

- Commit desplegado 7dac6b04eba236a271cba023ecfa58a7ab4d0849 confirmado con x-build-sha. CI checks success: https://github.com/LeonardoVenezia/active-clone/actions/runs/42518300214/job/128846039695 . No merge ni cambios de prod, secretos o configs preexistentes.
- Allow once del vault recibido 17:05; retry directo aceptado. Cuenta QA confirmada por sesión: Active-clone QA, leovenezia@outlook.com.ar. Envíopack autentica (Connection successful).
- Conexión nueva 4828aa8ouak1jsaonnxlm: "Envíopack QA preview - solo lectura", creada 20:06:34 UTC, etiqueta ajustada 20:07:00 UTC. Aislamiento real: pertenencia al usuario QA y cifrado con clave preview; NO es DB separada ni una credencial limitada por el proveedor a lectura. El flujo usa únicamente lectura; no reutilizar desde prod, no asociar a otros workflows ni usar acciones de envío. Las cuatro conexiones originales conservan sus updatedAt exactos (último ML 2026-11-07T17:48:05.194Z).
- Workflow nuevo privado opgv7dipiea638jzjs1m5: "QA Envíopack preview - lectura de sucursales", sólo Manual → enviopack/list-branches, conexión nueva. Verificado antes de ejecutar: dos nodos, una arista, sin acciones de escritura. URL: https://active-clone-git-soluciones-c-911406-leonardo-venezias-projects.vercel.app/workflows/opgv7dipiea638jzjs1m5 .
- Ejecución 0xqhydflrjlug89esr03z terminó 20:09:53.938 UTC con status success, output.success true y 154 sucursales reales (muestras id 1 OCA Azul, id 2 OCA Chascomús). No éxito vacío; sin envíos, cargos ni mensajes.
- GET ML en preview después del deploy: configReadable false, 0 campos, updatedAt intacto. No PUT/DELETE sobre conexiones reales para probar rechazo. La UI bloqueada se verifica abriendo el diálogo, sin guardar.

- Verificación visual del guard: diálogo Edit Mercado Libre muestra aviso en español; Delete, Test y Update disabled=true y campos deshabilitados. Sólo GET; ningún intento de write sobre la conexión original. Captura 2026-11-08 17:11:26 -03. Fixture de casos reabierto después del deploy: tres filas pendientes y acciones visibles, sin mutar.


## Cierre de incremento 8-nov 17:16: base verificada, no arquitectura completa

- Guard y refuerzo final af864dd con CI success: https://github.com/LeonardoVenezia/active-clone/actions/runs/42519002096/job/128848152725 . 32/32 tests workflows, tsc limpio, lint del diff completo sin errores (11 warnings existentes).
- Guía publicada privada generación 7, misma URL: https://files.instinct.com/ljprore922eg-guia-de-active-clone-por-recorridos . Todos los recorridos identifican PREVIEW + entrada; producción sólo referencia. Pruebas activas de fixtures 1-7 y 16-21; configuración 8-14 referencia hasta preparar pruebas individuales aisladas; 22 sólo mirar conexiones. Envíopack: inspección de la lectura real ya obtenida, sin repetirla.
- Las cinco demos siguen siendo tablas genéricas alimentadas por datos ficticios. Orden de bloques, marca y acciones de Estado son una base reutilizable, no reemplazan la experiencia dedicada de cada caso.
- Stock: falta componer y validar experiencia de alertas, controles y fuentes reales elegidas. Envíos: falta experiencia de excepciones e ingesta de envíos (sucursales no la valida). Conciliación: falta experiencia propia de diferencias venta/cobro con sus fuentes; sin pruebas de dinero. Avisos: falta experiencia de revisión de borradores y sus estados, sin sugerir envíos. Soporte: falta experiencia de consultas, borradores y derivación humana; una acción de Estado no es una derivación externa.
- Para cada caso hay que verificar su configuración de fuentes, estados vacíos/error, diseño y acciones. Esto concreta el pedido original de frontends por caso, sin ampliar a efectos comerciales no aprobados.
- Incremento guard + lectura Envíopack + guía queda cerrado y verificado. Arquitectura permanece Haciendo en Trello; no se pide una nueva decisión de producto para continuar la parte visual/técnica sin costo. Las limitaciones ML/Zipnova permanecen y no habilitan nuevos cambios de secretos ni prod.

## Bitácora 8-nov (tarde-noche): vistas dedicadas por caso

**Slot `view` del nodo Solución + cinco experiencias dedicadas (commit 9404e32).** La config de la solución gana un parámetro declarativo `view` (Nivel 2 ampliado): un registro CERRADO de vistas dedicadas (`stock-alertas`, `envios-excepciones`, `conciliacion-diferencias`, `avisos-borradores`, `soporte-consultas`) en `lib/soluciones/views.ts`. Clave ausente o desconocida se descarta y el panel genérico sigue siendo el fallback: ninguna solución existente cambia sin config explícita. Extracción del reporte del caso (filas/resumen/advertencias/omitidos/fueraDeAlcance) concentrada en el módulo puro `lib/soluciones/reporte.ts`. Componentes en `components/frontend-views/` con shell común (encabezado con marca, Ejecutar, fuentes) y layout propio por caso:

- **Stock**: indicadores del resumen + tarjetas por producto con motivo, stock contra mínimo y marca de detección (Nuevo / Ya detectado).
- **Envíos**: tarjetas por envío con canal, estado, motivo y detalle; aviso Nuevo destacado.
- **Conciliación**: tabla de diferencias venta/cobro con diferencia calculada cuando ambos montos son numéricos, estados semánticos (Conciliado / Diferencia / sin cobro / sin venta) y sección "Alcance de este reporte" con los límites (fueraDeAlcance). Sólo lectura: no mueve dinero.
- **Avisos postcompra**: tarjetas de borrador con el texto citado y marca "todavía no se envió nada al cliente"; omitidos con su motivo.
- **Soporte**: dos secciones (pendientes de aprobación con borrador citado; derivadas a una persona con motivo), la derivación se muestra como marca interna registrada, nunca como acción externa.

Las cinco demos QA (l0dkaj67, sjrejqbx, zd8gmw9n, cmspos2u, bymstnlf) recibieron su nodo Solución con `view`, marca, bajada, texto de vacío y fuentes declaradas por caso (activas ficticias figuran "sin datos" porque la última ejecución leyó el fixture, no la fuente: estado honesto; inactivas figuran "desactivada: no se consulta"). Tests nuevos en `tests/workflows/solution-views.test.ts` (registro cerrado, parse defensivo, extracción del reporte, celdas seguras): 40/40 verdes en tests/workflows, tsc y lint de archivos tocados limpios.

## f3e5d20 (8-nov): ajustes de copy honesto

- Envíos: KPI interno pasa de "Ya avisadas" a "Ya detectadas" (marca interna, nunca implica avisos enviados).
- Avisos y soporte: las advertencias de los registros declaran "estos borradores no se envían desde esta demo" (sin prometer flujos de aprobación/envío no implementados).
- Fuentes de las demos QA: todas figuran Desactivada ("la demo no las consulta"); datos simulados, no fuentes conectadas vacías.
