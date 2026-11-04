# Crear workflows a mano en Active-clone

Guía para Leonardo y para un agente de código. No depende del chat.

Estado documentado: 4 de noviembre de 2026. Baseline publicado `b34f805af6a66ff4e669ae4793a0e42b93799193`, con contenido idéntico a `d9a5c632de21c4f96f1c4c2eb6530655d2c98fc6`. Los ejemplos describen ese código. No son importaciones ya realizadas ni prueban una ejecución real de esta guía.

## Índice

1. [Decisión y vías de trabajo](#1-la-decisión-y-las-dos-formas-de-trabajar)
2. [Empresa, permisos y contrato](#2-empresa-permisos-y-contrato-previo)
3. [Editor y disparadores](#3-editor-visual-paso-a-paso)
4. [Referencias y tipos](#4-referencias-orden-y-tipos)
5. [Datos y operaciones](#5-datos-operaciones-resultados-y-límites)
6. [Receta completa](#6-receta-completa-visual-y-sin-integraciones)
7. [Frontend y otros nodos](#7-campos-frontend-y-otros-nodos)
8. [Agente de código](#8-contrato-técnico-para-un-agente-de-código)
9. [Diagnóstico](#9-diagnóstico)
10. [Evidencia y pendientes](#10-evidencia-y-pendientes)
11. [Checklist](#11-checklist-de-entrega)

## 1. La decisión y las dos formas de trabajar

El chat queda como herramienta interna de Leonardo, no como interfaz que deban usar los clientes ni como requisito para avanzar. Puede usarse un agente de código si hace mejor el trabajo. Conseguir que el chat sea útil no bloquea el armado manual.

Esta documentación no cambia controles de acceso: escribir que el chat es interno no lo oculta automáticamente. Tampoco autoriza mensajes, pagos, cambios de stock real o cambios de cuentas.

- **Editor visual:** permite crear nodos, configurar campos, conectarlos, guardar y ejecutar. Las recetas iniciales usan valores fijos y se pueden hacer por esta vía.
- **Agente de código:** puede preparar el grafo y las configuraciones que la UI no expone. Debe guardar por una vía autorizada y comprobar lo persistido. Preparar un JSON no significa haberlo cargado.

La pestaña Código/exportación no es un importador general de JSON de grafo. No pegar allí un grafo esperando que se guarde.

| Capacidad | Estado del baseline | Qué hacer |
| --- | --- | --- |
| Datos y applyTogether | Publicado | Usar el editor y verificar resultados de negocio |
| inputFields de Manual | Contrato soportado, editor de campos ausente | Preparar con agente de código; el diálogo de ejecución recoge campos ya definidos |
| Loop | Fuente/máximo editables, pasos internos solo visibles | Preparar `config.steps` por código si hace falta |
| Datos dentro de Loop | No soportado por el scope actual del executor | No usarlo para stock multilínea |
| Formatos nuevos valueFormat/expectedFormat/operationsFormat | No publicados aquí | No depender de ellos |
| Armador por chat | E2E pendiente | No es gate para usar workflows soportados |

## 2. Empresa, permisos y contrato previo

1. Iniciar sesión con la identidad correcta, abrir **Empresas** y entrar en la empresa destino.
2. Usar **Crear workflow** desde esa empresa. Un workflow personal y uno asignado a empresa no son equivalentes.
3. Datos usa la empresa del workflow, resuelta en servidor. No se elige otra empresa agregando un campo en un nodo.
4. Para Datos hacen falta acceso al workflow y pertenencia a su empresa. Para definir campos hace falta Dueño/Admin.
5. Practicar con colecciones de prueba y sin tiendas, envíos ni cobros. Un workflow pausado no es una simulación: la ejecución manual puede producir efectos.
6. Anotar empresa, ID del workflow, colecciones, claves y execution IDs. No borrar datos compartidos sin revisar quién depende de ellos.

Antes de dibujar, escribir:

| Pregunta | Ejemplo |
| --- | --- |
| ¿Qué inicia la ejecución? | Botón Manual, una línea de venta |
| ¿Qué campos entran? | plataforma, pedido, linea, tipo, sku, cantidad |
| ¿Cómo se identifica el evento? | plataforma + pedido + ID de línea + tipo económico |
| ¿Qué cambia? | Movimiento y saldo del SKU |
| ¿Qué es rechazo normal? | Repetido o stock insuficiente |
| ¿Qué pasa después de aplicar? | Marca interna, sin enviar mensajes |
| ¿Cómo se verifica? | Leer saldo/movimiento/marca; repetir evento |

El SKU o la variante no reemplazan necesariamente el ID de línea. Dos líneas del mismo SKU siguen siendo eventos distintos. `cancelled` por sí solo no prueba que corresponda reponer ni cuántas unidades.

## 3. Editor visual, paso a paso

1. Crear el workflow dentro de la empresa. Poner un nombre reconocible en Propiedades.
2. Seleccionar el disparador inicial. Si es placeholder, elegir explícitamente **Manual**.
3. Usar **Agregar paso** y elegir acción. Para datos persistentes elegir Datos; para una puerta lógica, Condition.
4. Seleccionar el nodo y completar el panel. Usar nombres como "Aplicar venta" y "Solo aplicado".
5. Conectar la salida del anterior a la entrada del siguiente mediante los conectores. Acercar dos nodos no los conecta.
6. Mantener un único disparador. No dibujar dos para representar dos casos: usar workflows separados o una entrada explícita.
7. Usar **Guardar workflow**, recargar y comprobar campos/conexiones.
8. Revisar los efectos antes de **Guardar y ejecutar**.
9. En Ejecuciones revisar cada resultado, no solo el color final.

Guardar no ejecuta. Ejecutar manualmente no equivale a activar un disparador externo. Para Integration event elegir evento, conexión exacta y revisar Estado. No registrar la URL en un proveedor real mientras se practica.

### Disparadores distintos de Manual

- **Schedule:** configurar expresión cron y zona horaria en el panel. Revisar que la zona sea la del negocio y no asumir la del navegador. Antes de activarlo, comprobar su comportamiento en el entorno concreto; dibujarlo no prueba que exista un scheduler funcionando.
- **Webhook:** guardar para obtener la URL que muestra el panel; usar esa URL, no inventarla. El esquema opcional describe el request esperado. Revisar la implementación/autenticación y el cuerpo recibido antes de conectar efectos reales. No publicar la URL como si fuera un enlace de consulta.
- **Integration event:** seleccionar evento, después la conexión compatible. Cambiar evento puede vaciar la conexión. El panel muestra la URL de notificación del proveedor y Activar/Pausar. Una conexión disponible no demuestra que el proveedor esté enviando eventos.

Privacidad del workflow y pertenencia a empresa son controles distintos. Hacer público un workflow no convierte automáticamente una página Datos en acceso público sin autenticación.

## 4. Referencias, orden y tipos

Forma explícita:

```text
{{@ID_DEL_NODO:Etiqueta.campo}}
```

Ejemplos ficticios:

```text
{{@manual:Manual.sku}}
{{@leer:Leer saldo.record.value.stock}}
{{@aplicar:Aplicar venta.estado}}
{{@formula:Calcular.result}}
```

En campos compatibles, escribir `@` abre el selector de resultados. Usarlo para recuperar IDs/rutas. Si el catálogo no lista un campo que devuelve realmente el paso, puede escribirse la referencia explícita después de verificar el resultado. No inventar `data.items` por costumbre.

- Conectar el productor antes del consumidor. Una referencia no impone orden.
- IDs estables identifican al productor; etiquetas ayudan a leer.
- Dos hijos del mismo padre pueden correr en paralelo. La posición del lienzo no ordena.
- Leer Datos devuelve `record.value`; Fórmula devuelve `result`. Inspeccionar cada salida real.

### Tipos de configuración

El executor sustituye referencias en valores config que son strings. No recorre de forma general objetos/arrays reales para resolver referencias internas.

- `{"stock":5}` en Valor de Datos es un objeto JSON; `hola` es texto.
- En Aplicar cambios juntos, la UI convierte valores objeto/lista y serializa la lista como string JSON en `operations`.
- `{"cantidad":"{{@manual:Manual.cantidad}}"}` no promete número: el valor entre comillas puede terminar como texto.
- Para restar usar Cantidad a sumar `-2` o `-{{@manual:Manual.cantidad}}`.
- El baseline escapa referencias dentro de strings JSON de `operations`. No extender esa garantía a todos los `value`/`expected` individuales. Probar comillas y saltos de línea en el campo concreto.
- Las correcciones de serialización tipada en ramas no son parte de este baseline.
- No guardar secretos ni respuestas completas de cuentas reales como depuración.

## 5. Datos: operaciones, resultados y límites

Datos es colección + clave + valor dentro de una empresa. Workflows de la misma empresa pueden compartir una colección.

- Colección: hasta 40 caracteres, minúsculas/números/underscore.
- Clave: hasta 120, letras/números y `. _ : @ -`. No usar espacios, `/` ni `|`.
- Valor: hasta 16 KB; hasta 5000 registros por colección.
- Listar: 50 por defecto, máximo 200. Una respuesta no es una exportación completa.
- applyTogether: hasta 10 cambios; no repetir colección+clave dentro del conjunto.

| Operación UI / config | Campos | Mirar en la salida |
| --- | --- | --- |
| Guardar un dato / save | collection, key, value | record |
| Guardar solo si no existe / saveIfAbsent | collection, key, value | creado, record, posible repetido |
| Actualizar solo si coincide / updateIfMatches | collection, key, expected, value | actualizado, motivo, record |
| Sumar a un número / add | collection, key, field, amount; min/max/startAtZero opcionales | aplicado, valor, motivo |
| Aplicar cambios juntos / applyTogether | operations | estado; records o motivo/operacion |
| Leer un dato / read | collection, key | found, record (puede ser null) |
| Listar los últimos datos / list | collection, limit | records, count |
| Definir campos / fields | collection, fields | collection, fields |

Guardar reemplaza todo el valor, no hace merge. Actualizar si coincide compara el valor esperado completo y no pisa un cambio concurrente distinto. Sumar no evita negativos salvo que se defina mínimo. No activar empezar en cero para ocultar un saldo faltante.

**success=true y ejecución verde son éxito técnico, no prueba de efecto de negocio.** applyTogether rechazado puede devolver success=true, estado=rechazado, operacion (posición desde 1), motivo. Si aplica devuelve estado=aplicado. Los errores técnicos son otra clase de falla.

### Puertas correctas

Después de cada operación condicional, agregar Condition antes de efectos que dependan de ella:

```text
{{@aplicar:Aplicar venta.estado}} === 'aplicado'
{{@crear:Crear movimiento.creado}} === true
{{@actualizar:Actualizar.actualizado}} === true
{{@sumar:Sumar.aplicado}} === true
{{@leer:Leer saldo.found}} === true
```

Reemplazar IDs por los reales. No comparar un booleano con el string 'true'. Condition permite seguir cuando da true; false omite descendientes. No hay un puerto else general documentado en este executor. Ningún otro camino debe permitir al efecto eludir la condición.

### Replay no es deduplicación de eventos

El ID estable de una llamada evita repetir su efecto durante replay/reintento técnico. Una nueva ejecución no es ese replay.

Para deduplicar un evento en ejecuciones diferentes, incluir su movimiento saveIfAbsent y el descuento add en el mismo applyTogether. Si el movimiento existe, se rechaza todo y el saldo no cambia. En pasos separados puede quedar movimiento sin descuento si el segundo falla. add aislado en una nueva ejecución puede descontar otra vez.

### Ejemplos de las demás operaciones

Usar colecciones aparte de la receta de stock para no alterar su semilla:

- **Guardar:** collection `manual_demo_estado`, key `pedido_1`, value `{"estado":"pendiente","version":1}`. read debe mostrar ese objeto completo.
- **Actualizar si coincide:** misma colección/clave, expected `{"estado":"pendiente","version":1}`, value `{"estado":"procesado","version":2}`. Primera ejecución: actualizado=true. Otra ejecución con el mismo expected: actualizado=false, sin pisar el valor nuevo. Un nuevo expected debe reflejar la decisión del proceso, no un reemplazo a ciegas.
- **Guardar si no existe:** collection `manual_demo_eventos`, key `evento_1`, value `{"origen":"prueba"}`. Primera vez creado=true; siguiente creado=false. Conectar lo posterior a creado=true.
- **Sumar:** sobre un registro existente `{"contador":0}`, field `contador`, amount `1`, min `0`, max `10`. Una ejecución nueva vuelve a sumar. Probar el máximo sin interpretar rechazo como éxito de negocio.
- **Listar:** collection `manual_demo_eventos`, limit `20`. Mirar records/count; no asumir que devuelve todos los registros si hay más.
- **Campos:** usar el formato de la sección 7. Separar workflow de configuración de los workflows operativos para no redefinir el esquema en cada venta.

## 6. Receta completa, visual y sin integraciones

Usa valores fijos y una sola línea. No modifica tiendas ni envía mensajes.

### A. Semilla separada

Crear "Demo manual: semilla":

1. Manual → Datos, Guardar un dato.
2. Colección `manual_demo_saldos`, clave `SKU_DEMO`.
3. Valor `{"stock":5}`.
4. Guardar, ejecutar una vez y comprobar con read que stock es número 5.

No poner la semilla en el workflow de venta: reiniciaría el saldo en cada ejecución. No volver a ejecutarla entre original y repetido.

### B. Venta y marca interna

Crear "Demo manual: aplicar venta":

1. Trigger Manual.
2. Datos "Aplicar venta", operación Aplicar cambios juntos.
3. Agregar cambio 1, Guardar solo si no existe:
   - collection `manual_demo_mov`
   - key `demo:PEDIDO_001:LINEA_001:venta`
   - value `{"sku":"SKU_DEMO","cantidad":2,"tipo":"venta"}`
4. Agregar cambio 2, Sumar a un número:
   - collection `manual_demo_saldos`, key `SKU_DEMO`
   - field `stock`, amount `-2`, mínimo `0`
   - empezar en 0 desmarcado
5. Conectar Manual → Aplicar venta.
6. Agregar Condition "Solo aplicado" con referencia real a estado y `=== 'aplicado'`.
7. Conectar Aplicar venta → Solo aplicado.
8. Agregar Datos "Marcar aviso", Guardar solo si no existe:
   - collection `manual_demo_avisos`
   - key `demo:PEDIDO_001:LINEA_001:venta`
   - value `{"tipo":"venta_aplicada","sku":"SKU_DEMO","mensaje":"Aviso interno de prueba"}`
9. Conectar Solo aplicado → Marcar aviso, sin otro padre.
10. Guardar, recargar y verificar conexiones/campos.

La marca es un dato interno, no un envío. No existe una transacción distribuida entre ese registro y un mensaje externo futuro.

### C. Comprobaciones

Crear consulta Manual → Datos read. Cambiar colección/clave para consultar saldo, movimiento y aviso.

| Prueba | Acción | Resultado esperado |
| --- | --- | --- |
| Original | Ejecutar venta una vez | aplicado; stock 3; movimiento y aviso presentes |
| Repetido | Ejecutar sin cambiar clave | rechazado; stock sigue 3; ninguna segunda marca |
| Insuficiente | Cambiar clave de movimiento a `demo:PEDIDO_001:LINEA_002:venta` y amount a -10 | rechazado; stock 3; movimiento LINEA_002 ausente |
| Ausente | read de LINEA_002 | found=false, record=null; no interpretarlo como cero |

Es una matriz secuencial, no prueba concurrencia ni carga. Si falla, conservar execution ID y valores leídos; no continuar hacia efectos reales ni borrar la evidencia.

### D. Umbral una sola vez

Después de aplicación exitosa: read saldo → Condition found=true y stock bajo umbral → saveIfAbsent en `manual_demo_alertas`, clave `SKU_DEMO:umbral_2:ciclo_1` → Condition creado=true → eventual acción autorizada.

La clave fija impide otro aviso incluso después de reponer y volver a caer. Si hace falta aviso por ciclo, definir el ciclo y su reinicio explícitamente. No inventar borrados automáticos. Un envío real sigue fuera de la atomicidad de Datos.

## 7. Campos, Frontend y otros nodos

### Campos definidos

Dueño/Admin puede usar Datos → Definir campos, por ejemplo:

```text
sku:texto:obligatorio
stock:numero:obligatorio
activo:booleano
alta:fecha
```

Guardar en esa colección debe respetar el esquema. Los registros previos no se convierten ni borran. Stock texto no equivale a stock número. Cambiar esquema no migra registros.

### Frontend

Es una página básica por workflow, con una colección Datos, tabla/columnas y botón de ejecución opcional. Puede incluir formulario basado en campos definidos. No es constructor de pantallas arbitrarias ni acceso anónimo por tener URL. Requiere sesión, acceso al workflow y pertenencia a empresa. El nodo no cambia registros por ejecutarse; el formulario usa su propia ruta y permisos. La actualización es por polling, no prometer tiempo real.

Si se configura ejecutar al enviar formulario, comprobar qué se guarda y qué input se transmite. No asumir que cada columna se vuelve input Manual.

### Fórmula

JSONata, no JavaScript general. Entrada `input`, expresión `expression`, salida `result`. Ejemplo: input `{"cantidad":2,"precio":10}`, expresión `cantidad * precio`, resultado esperado 20. Probarlo en el flujo concreto. No tiene IO/red. Expresión máximo 2000 caracteres, entrada 256 KB, evaluación 1 segundo.

### Delay y Approval

Delay espera minutos/segundos positivos, hasta 24 horas. No reemplaza una conexión serial entre productor y consumidor.

Approval pausa hasta decisión humana. No implica que haya enviado un aviso ni que cualquier usuario pueda aprobar. Comprobar ruta de decisión/permisos antes de usarlo. No vuelve atómicas acciones anteriores y posteriores.

### Unir

Dos hijos pueden correr en paralelo. Un nodo con varios padres no es por sí mismo una barrera; usar Unir:

- Esperar todas las ramas o hasta un tiempo máximo, hasta 24 horas desde la primera llegada.
- Elegir comportamiento ante fallo y timeout: fallar o continuar con lo recibido.
- Revisar inputs por ID sanitizado de padre, completed, failed, skipped, timedOut, hasTimedOut.
- Una rama omitida por Condition no debe confundirse con una respuesta exitosa.
- Timeout no cancela ramas tardías: pueden seguir gastando o escribiendo. No usarlo como cancelación de efectos.

### Loop

Fuente: una referencia a una lista real o JSON literal de lista. Máximo 50 ítems. Pasos internos secuenciales por ítem. Referencias `{{@item:Item.campo}}` y `{{@index:Index.number}}`. Un ítem fallido no impide necesariamente los siguientes: revisar failed/failedCount.

La UI edita fuente/máximo, pero solo muestra los pasos internos. Un agente de código puede preparar `config.steps`, array de `{id, actionType, config}`. El texto que sugiere pedirlo al chat no lo vuelve obligatorio.

Datos dentro de Loop no recibe el scope requerido por su ruta actual. No proponerlo para stock multilínea, no usar `products[0]` como si representara el pedido entero y no inventar un endpoint HTTP de reemplazo. Una línea por evento solo es válida si el proceso realmente aporta esa línea y su ID.

### Integraciones y HTTP

El catálogo describe acciones en código, no certifica conexión, permisos, saldo o disponibilidad del proveedor. Usar la cuenta exacta, probar lectura antes de escritura y no copiar integrationId ajenos.

Para HTTP revisar método, URL, autenticación, cuerpo y respuesta. No poner secretos en config. Tiendas, facturas, pagos y mensajes requieren revisión y autoridad del caso real. Esta guía no autoriza mensajes automáticos a compradores de Mercado Libre.

## 8. Contrato técnico para un agente de código

### Grafo mínimo fijo

Este JSON se prepara como archivo, no se pega en la pestaña Código. La semilla de la receta debe existir primero.

```json
{
  "name": "Demo manual fija: aplicar venta",
  "nodes": [
    {"id":"manual","type":"trigger","position":{"x":0,"y":0},"data":{"type":"trigger","label":"Manual","config":{"triggerType":"Manual"}}},
    {"id":"aplicar","type":"action","position":{"x":250,"y":0},"data":{"type":"action","label":"Aplicar venta","config":{"actionType":"Datos","operation":"applyTogether","operations":"[{\"operation\":\"saveIfAbsent\",\"collection\":\"manual_demo_mov\",\"key\":\"demo:PEDIDO_001:LINEA_001:venta\",\"value\":{\"sku\":\"SKU_DEMO\",\"cantidad\":2}},{\"operation\":\"add\",\"collection\":\"manual_demo_saldos\",\"key\":\"SKU_DEMO\",\"field\":\"stock\",\"amount\":\"-2\",\"min\":\"0\"}]"}}},
    {"id":"gate","type":"action","position":{"x":500,"y":0},"data":{"type":"action","label":"Solo aplicado","config":{"actionType":"Condition","condition":"{{@aplicar:Aplicar venta.estado}} === 'aplicado'"}}},
    {"id":"aviso","type":"action","position":{"x":750,"y":0},"data":{"type":"action","label":"Marcar aviso","config":{"actionType":"Datos","operation":"saveIfAbsent","collection":"manual_demo_avisos","key":"demo:PEDIDO_001:LINEA_001:venta","value":"{\"tipo\":\"venta_aplicada\",\"sku\":\"SKU_DEMO\"}"}}}
  ],
  "edges": [
    {"id":"e1","source":"manual","target":"aplicar","type":"animated"},
    {"id":"e2","source":"aplicar","target":"gate","type":"animated"},
    {"id":"e3","source":"gate","target":"aviso","type":"animated"}
  ]
}
```

- Mantener `type` y `data.type` consistentes.
- Acción en `data.config.actionType`; Datos usa además operation.
- No dejar nodos `add` del lienzo ni placeholder=true como pasos ejecutables.
- Construir operations con `JSON.stringify(lista)`, no concatenar entradas del usuario.
- IDs únicos, extremos existentes, sin ciclos, un trigger explícito.
- No agregar contratos de formato de ramas no publicadas.

### Inputs Manual por configuración

El panel actual no crea esta lista. El agente puede configurar el trigger así:

```json
{
  "triggerType": "Manual",
  "inputFields": [
    {"key":"plataforma","label":"Plataforma","required":true},
    {"key":"pedido","label":"Pedido","required":true},
    {"key":"linea","label":"ID de línea","required":true},
    {"key":"tipo","label":"Tipo económico","required":true},
    {"key":"sku","label":"SKU","required":true},
    {"key":"cantidad","label":"Cantidad","required":true}
  ]
}
```

Máximo 8 campos; key inicia con letra y usa letras/números/underscore, hasta 40. Label hasta 80. Valores son strings limpiados, máximo 500. Nombres reservados incluyen triggered, timestamp, constructor, prototype y otros de `lib/manual-input.ts`.

Cambiar clave de movimiento a:

```text
{{@manual:Manual.plataforma}}:{{@manual:Manual.pedido}}:{{@manual:Manual.linea}}:{{@manual:Manual.tipo}}
```

Clave saldo `{{@manual:Manual.sku}}`, amount `-{{@manual:Manual.cantidad}}`.

Obligatorio solo exige presencia. Antes del efecto validar cantidad positiva, caracteres/longitud de IDs, tipo económico permitido y correspondencia real de SKU/línea. La clave compuesta completa debe caber en 120 caracteres. No activar la variante hasta probar originales, repetidos, inválidos e insuficientes. Esta configuración no resuelve por sí sola pedidos multilínea.

### Guardar por la API existente

Contratos de aplicación, con sesión autorizada:

| Ruta | Uso |
| --- | --- |
| POST /api/workflows/create | name, nodes, edges; organizationId para empresa. Valida pertenencia e integraciones |
| GET /api/workflows/{id} | Leer estado actual/permisos antes de editar |
| PATCH /api/workflows/{id} | Actualizar nodes/edges completos, no merge semántico de grafos |
| POST /api/workflow/{id}/execute | Body `{"input":{...}}`; inicio no certifica finalización |

Para crear desde un cliente autorizado del proyecto, agregar organizationId al objeto de grafo y usar `api.workflow.create` de `lib/api-client.ts` o su ruta correspondiente. Recuperar el ID de la respuesta y volver a leerlo. No inventar token/API pública ni saltar autenticación. Un agente con acceso solo de lectura entrega archivo e instrucciones, no afirma haberlo importado.

Antes de actualizar, guardar snapshot de nodes/edges y comprobar que otro editor no cambió el workflow. Después, GET y comparación de configuración/edges. Para ejecutar, revisar el run terminado y leer los registros esperados.

Una entrega técnica incluye: empresa/ID/nombre, grafo sin secretos, referencias y tipos, método de guardado, matriz de pruebas, execution IDs, datos antes/después y límites. Separar fixtures de cuentas reales. Una falta del editor no autoriza modificar producto, hacer merge/deploy ni migraciones.

## 9. Diagnóstico

| Síntoma | Revisar |
| --- | --- |
| Verde sin cambio de stock | estado/aplicado/motivo, no success técnico |
| Repetido descuenta otra vez | Clave cambiante o add fuera del conjunto atómico |
| Movimiento sin descuento | Pasos separados, semilla repetida o ejecución incompleta |
| Leer devuelve null | found, empresa, colección, clave; no asumir cero |
| Número rechazado | Valor numérico real, no string; esquema compatible |
| Referencia literal | ID/ruta/padre ejecutado y config string |
| JSON termina como texto | JSON inválido tras sustitución, comillas y tipos |
| Aviso corre tras rechazo | Gate por success o camino que elude Condition |
| Nodo de ramas corre pronto | Falta Unir o conexión serial |
| Loop incompleto | maxItems y failed/failedCount |
| Datos falla en Loop | Límite conocido; no parchear con endpoint inventado |
| Empresa no aparece | Sesión/carga/scope/pertenencia; no concluir otra cuenta sin evidencia |
| Chat dice Listo sin nodos | No hay construcción demostrada, continuar por vía manual |

## 10. Evidencia y pendientes

Esta guía distingue contratos leídos en el código publicado de pruebas offline y de una ejecución real del workflow concreto. La matriz de la receta es un criterio de aceptación, no una afirmación de que esta copia haya sido ejecutada en producción.

Las ramas `datos-key-guard` (7f36c19, producto 76a1d10) y `fix-no-build-truth` (a1ac76e local) no son este baseline. Sus pruebas no certifican cliente autenticado + Postgres + modelo real. No copiar sus capacidades como publicadas.

El intento QA del armador del 4/11 fue revertido: el resultado visible no construyó un workflow utilizable. Producción volvió a b34f805. La construcción por chat y sus pruebas E2E siguen pendientes; no condicionan estas recetas manuales soportadas.

## 11. Checklist de entrega

- [ ] Identidad, empresa y permisos comprobados.
- [ ] Trigger explícito, sin placeholders ni nodos desconectados por accidente.
- [ ] Inputs existentes, tipos y referencias comprobados.
- [ ] Guardar/recargar conserva config y edges.
- [ ] Conditions sobre el resultado de negocio, sin bypass.
- [ ] Replay técnico y dedupe de evento separados.
- [ ] Todo cambio atómico de Datos en el mismo conjunto; efectos externos fuera de esa promesa.
- [ ] Original/repetido/insuficiente/ausente probados; IDs y lecturas conservados.
- [ ] Activación externa revisada aparte, sin efectos reales por defecto.
- [ ] Límites escritos, sin presentar mocks o verde como prueba de negocio.

## Fuentes para mantener la guía

Rutas del repositorio en el baseline indicado:

- [Editor de acciones](../components/workflow/config/action-config.tsx), [triggers](../components/workflow/config/trigger-config.tsx), [condiciones](../components/workflow/config/condition-config.tsx).
- [Inputs Manual](../lib/manual-input.ts).
- [Core Datos](../lib/datos/core.ts), [configuración atómica](../lib/datos/together-config.ts), [acceso](../lib/datos/access.ts), [Frontend](../lib/datos/frontend.ts), [paso Datos](../lib/steps/datos.ts).
- [Executor](../lib/workflow-executor.workflow.ts), [Fórmula](../lib/steps/formula.ts), [cliente API](../lib/api-client.ts).
- [Crear workflow](../app/api/workflows/create/route.ts), [leer/editar](../app/api/workflows/[workflowId]/route.ts), [ejecutar](../app/api/workflow/[workflowId]/execute/route.ts).

Al actualizar, registrar SHA publicado y volver a comprobar contratos/UI. No convertir una rama o un test en una capacidad publicada.
