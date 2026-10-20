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
