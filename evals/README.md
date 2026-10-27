# Evaluaciones del builder/chat (arnés)

Registro versionado de fallas del builder embebido y set de casos de prueba.
Principio rector (doc de investigación de Leo): cada falla encontrada en pruebas o
producción se registra acá, se convierte en un caso de prueba y se vuelve a correr
todo el set como regresión ante cada cambio de prompt, tool o modelo.

## Archivos

- `failures.jsonl` — una línea JSON por falla observada. Campos:
  - `id`: F-AAAA-MM-DD-NN
  - `area`: `service:<nombre>`, `action:<plugin/acción>` o `pattern:<nombre>`
  - `symptom`: qué se vio (con escenario/fecha)
  - `cause`: causa probable (hipótesis a validar)
  - `good_example`: cómo debería salir (sirve de ejemplo para el prompt)
  - `status`: `open` | `mitigated` (hay regla/fix pero recae) | `fixed` | `pending-verification`
  - `cases`: ids de casos en `cases.jsonl` que la cubren
  - `source`: escenario/ronda donde se observó
- `cases.jsonl` — una línea JSON por caso de prueba. Campos:
  - `id`: C-NN
  - `name`: nombre corto
  - `request`: pedido del usuario en español rioplatense, tal como se escribiría en el chat
  - `assertions`: lista de chequeos determinísticos sobre el flujo resultante
    (nodos por actionType, conectividad, refs válidas, ausencia de placeholders, etc.)
  - `failures`: ids de fallas relacionadas
  - Correr cada caso 3 veces (el modelo es estocástico) y reportar tasa de pasada.

## Estado del runner

Todavía no hay runner automático: los casos se corren a mano por el chat en la
cuenta QA (modo maqueta, sin ejecutar). El runner es la Etapa 1 pendiente.

## Arnés (`evals/harness/`)

Corre el `unifiedResponse` real (sin tocar producción: usa los `deps` que ya admite) y guarda por corrida un
artefacto completo: cada turno, el grafo final con configs (fórmulas, Loops, aiPrompt), la salida del validador,
cada llamada al modelo (etapa, tool calls con sus inputs, texto, uso de tokens) y el build trace de la app.
Las aserciones están fijadas de antemano en `cases.jsonl` (`checks`; sin `checks` se usan las por defecto) y
devuelven `pass | fail | unknown | na`. `unknown` = el contrato declarado no alcanza para decidir; nunca cuenta como fail.

- `npx tsx evals/harness/offline.mts`: modelo simulado. Prueba CABLEADO y REGLAS, no calidad de ningún modelo.
- `npx tsx evals/harness/live.mts ...`: modelos reales. Por defecto es dry run (matriz, claves faltantes, estimación
  de tokens/costo); solo llama con `--run`, y las rutas pagas además piden `--allow-paid`. Modelos en `models.json`.
  Los artefactos quedan FUERA del repo (es público): `~/active-clone-eval-runs` por defecto, o `EVAL_OUT_DIR` / `--out`;
  una ruta dentro del repo se rechaza.
- Variantes de orquestación: `current` (como producción) y `no-correctives` (las rondas correctivas reciben una
  respuesta vacía en vez de llegar al modelo; la pasada guía sí llega).
- `fail` solo cuando el código lo demuestra (nodo inexistente, fuente de Loop que el motor no lee, campo fuera de un
  contrato exacto: paso de IA, Fórmula, inputs de Manual). Los `outputFields` de plugins son texto libre y pueden estar
  incompletos: un campo que no listan da `unknown`.
- Los checks marcados `signal` son indicios, no garantía de que el flujo funcione: `ai_prompt_backed` sigue la cadena de
  referencias desde el aiPrompt hasta un paso fuente (no prueba que los valores lleguen en ejecución);
  `disclosed_if_dropped` y `text_absent` son regex sobre el texto (una mención con negación no prueba un aviso correcto).
  Revisar a mano una muestra.
- Límites del arnés (`--call-ms`, `--run-ms`): por llamada al modelo, la app recibe un error al vencer aunque el proveedor
  ignore el aborto; por corrida completa (todos los turnos), cada corrida va en su propio proceso y al vencer se mata
  (SIGKILL). El artefacto se arma con lo último registrado y lista lo incompleto. Ninguno de los dos detiene al proveedor:
  puede seguir procesando y cobrando la llamada.
- Incidentes por corrida: `harness-run-timeout`, `harness-call-timeout`, `transport` (conexión: red, proxy o proveedor, no
  distinguible), `provider` (status HTTP o evento de error del proveedor), `app-limit` (tope de tiempo del build o rondas
  correctivas agotadas; no se atribuye causa), `unclassified`. Con un incidente que no sea `app-limit` la corrida es
  "interrumpida" y se reporta aparte de las evaluaciones completas, con sus checks sobre el parcial.
- No hay un "pass" agregado: `summary.txt` separa por corrida y por caso los checks determinísticos de las señales, con
  pass/fail/unknown/na.

## Dos niveles de aceptación

1. **PASS estructural** — los `expect` de `cases.jsonl` sobre el grafo
   (tipos de nodo, toolkits, sin huérfanos/placeholders/HTTP manual).
2. **Aceptación semántica** — `evals/semantic/`: simulación determinística
   del flujo contra un fixture con datos conocidos; verifica que la salida
   efectiva (Sheets/email/Slack) sea la pedida. Hoy cubre C-09 y C-12.

Al reportar una medición, separar los dos niveles y citar el set completo:
la medición estructural completa vigente es run 3
(`2026-10-21-first-try-rerun2.jsonl`, 10/12 casos, 18/24 corridas); las
re-mediciones dirigidas posteriores (p.ej. `2026-10-21-targeted-rerun.jsonl`,
6 corridas sobre 3 casos) no son una medición completa.

## Confiabilidad de mediciones (2026-10-21)

- Runs 1-3 (`2026-10-20-first-try*.jsonl`, `2026-10-21-first-try*.jsonl`,
  `2026-10-21-targeted-rerun.jsonl`): evaluados a MANO, caso por caso, con
  notas en `violations`/`notes`. NO contaminados por el bug del checker
  automático; sus números se mantienen, pero son juicios manuales.
- `2026-10-21-fullrun-baseline.jsonl` y `2026-10-21-fullrun-fulljson.jsonl`
  en commits anteriores a d182236: NO CONFIABLES. El checker automático
  leía la key equivocada de `cases.jsonl` y pasaba todo (falso 12/12).
  Fueron re-generados en d182236 con `evals/structural-check.mjs`
  (checker determinístico permanente: require/forbid + inner steps de Loop).
  Números reales: ops 9/12, fullJson 8/12.
- La vara estructural automática desde d182236 es
  `evals/structural-check.mjs`: `node evals/structural-check.mjs <C-NN> <snapshot>`.
