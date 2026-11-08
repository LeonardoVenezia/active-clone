# Sistema visual — active-clone

Criterio de diseño aplicado con la guía **Impeccable** (pedido de Leo, 8-nov 15:45).
Alcance de esta pasada: el **panel del cliente** (`/frontend/[workflowId]`, `components/frontend-panel.tsx`).
El builder interno conserva el tema neutro actual; extender el sistema queda como trabajo futuro.
Modo oscuro sin revisar en esta pasada (los tokens de estado ya tienen valores `.dark`).

## Modo y escena

- **Modo Operate** (Impeccable): el visitante viene a completar una tarea (mirar sus datos, cargar un registro, ejecutar). La interfaz desaparece dentro de la tarea: precisión y contención, nada decorativo.
- **Escena de uso:** dueño de negocio, de día, escritorio y teléfono. Tema claro.
- **Familiaridad ganada:** patrones estándar (tabla con hover, tarjetas en móvil, formularios con labels), estados completos en cada componente.

## Color: cada color tiene un motivo

Todo vive en variables CSS en `app/globals.css` (se cambia en un solo lugar, pedido permanente de Leo).

| Token | Valor | Por qué |
|---|---|---|
| `--brand` (petróleo, 200°) | oklch(0.52 0.09 200) | Identidad de active-clone: datos en movimiento, calma y confianza. Reservado a la **acción primaria**, el indicador "en vivo", la marca y el foco de teclado. Nunca decoración. |
| `--success` (esmeralda, 165°) | oklch(0.60 0.13 165) | Estado "consulta exitosa" / guardado. |
| `--warning` (ámbar, 78°) | oklch(0.66 0.12 78) | Advertencias y "sin datos todavía": requiere atención, no es falla. |
| `--error` (rojo, 27°) | oklch(0.56 0.17 27) | Fallas y campos requeridos. |
| neutros | escala zinc existente | Texto y superficies; el gris no compite con los estados. |

Regla: **el color siempre significa estado**. Cada estado tiene tres variantes
(`--<estado>`, `--<estado>-subtle` para fondos, `--<estado>-foreground` para texto
sobre el fondo sutil) con contraste de texto ≥ 4.5:1. El petróleo (200°) se eligió
lejos del esmeralda (165°) para que "marca" y "éxito" no se confundan.

- Selección de texto teñida de marca (`::selection`).
- Anillo de foco (`--ring`) en tinte de marca, visible con teclado.

## Tipografía

- Una sola familia (Geist Sans): en producto no hace falta pareja display/body.
- Jerarquía por peso y tamaño (título `2xl` semibold con `tracking-tight`, secciones `font-medium`, metadatos `text-xs`).
- Números y fechas con cifras tabulares (`tabular-nums`) para que columnas y horas no "salten".
- Encabezados de tabla en `text-xs uppercase tracking-wider` atenuado: se leen como estructura, no como contenido.

## Layout y superficies

- Columna única centrada (`max-w-3xl`), espaciado generoso entre secciones.
- Tarjetas con borde 1px y radio 12px (`rounded-xl`), sin sombra: elevación declarada una sola vez (borde O sombra, nunca las dos).
- Tablas: fila de encabezado con fondo `muted/40`, filas divididas, hover con transición de color. En móvil (<640px) la tabla colapsa a tarjetas etiqueta/valor.
- La marca del cliente (slot `brand`) va a la derecha del título como wordmark, no como etiqueta encima del encabezado.

## Estados obligatorios (por componente)

default · hover · focus-visible · disabled · loading · error · empty.

- **Carga:** skeleton con las proporciones de la tabla (barras animadas), no "Cargando..." ni spinner.
- **Vacío:** estado que enseña (ícono + texto del slot `emptyText`), no un "nada aquí".
- **Error/aviso:** callout con ícono y fondo del estado semántico; el texto nombra el problema, nunca nombres internos (variables de entorno).
- **Mensajes de formulario:** éxito en fondo esmeralda sutil, falla en fondo rojo sutil.

## Movimiento: solo comunica estado

- Punto "en vivo" con pulso suave junto a "Se actualiza cada 5 segundos": es el único movimiento continuo y significa que el dato se refresca solo.
- Transiciones de 150–250 ms en hover de filas y botones.
- Skeleton al entrar. Sin animaciones orquestadas de entrada: el usuario viene a trabajar, no a mirar la página cargar.

## Copy

- Los controles nombran su acción ("Ejecutar", "Enviar"); los errores nombran el problema y la recuperación ("Falta conectar Stripe").
- Sin nombres internos ni IDs técnicos en pantalla del cliente.

## Verificación

Revisado renderizando el resultado (desktop y móvil) sobre el preview de la rama,
no solo el código: contraste, estados, skeleton, vacío y layout en ambos tamaños.

## Coherencia cliente vs backoffice (8-nov, segunda pasada)

- **Superficie cliente (`/frontend/...`) sin navegación del backoffice:** el panel ya no monta el header del builder (Empresas/History/Connections). Lo que ve el cliente es su solución: marca (slot `brand`) y título. El logo del producto queda sólo en el backoffice.
- **Nada de nombres internos en pantalla cliente:** el encabezado de datos es "Datos", nunca el slug de la colección; las columnas y campos usan el mapa `labels` de la config del nodo Frontend (el nombre técnico del campo no es copy de cliente).
- **El indicador "en vivo" significa refresco de la vista**, nunca frescura del proveedor: copy "Esta vista se actualiza cada 5 segundos". La frescura de cada fuente se muestra sólo como fecha de su última consulta registrada.
- **Movimiento reducido:** `prefers-reduced-motion` apaga pulso y transiciones.
