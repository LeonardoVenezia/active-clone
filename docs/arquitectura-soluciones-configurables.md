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
- Contratos cubiertos por tests (`tests/soluciones/`, 8 tests en el gate CI):
  parse defensivo, identificación de fuente por paso, inactividad explícita
  vs. activa vs. no declarada, contrato de ausencia, config desde nodos.
- Pendiente de validación end-to-end en preview con fixtures QA: fan-in mixto
  (activa + inactiva), todas inactivas, rama activa con error.
