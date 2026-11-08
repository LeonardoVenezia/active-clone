# Arquitectura: soluciones cerradas configurables y frontend por solución

Estado: **propuesta en revisión** (2026-11-08). Las decisiones marcadas como
"adoptada" vienen del pedido de Leo del 8-nov-2026 13:59 (WhatsApp); todo lo
demás es propuesta pendiente de su OK. Referencia operativa: tablero Trello
del proyecto.

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
