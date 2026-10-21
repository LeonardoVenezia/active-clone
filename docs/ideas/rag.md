# RAG (base de conocimiento con vectores) — PAUSADO

> **Estado: pendiente de validar demanda de mercado (Leo, 2026-10-20).**
> Mucha complejidad para el MVP. No implementar hasta que se valide que el mercado lo pide.
> Workaround MVP propuesto: leer un Google Doc/Sheets entero vía Composio y pasarlo como contexto al LLM (ver sección final).

## Objetivo

Dos nodos nuevos en el builder:

1. **"Subir documento"**: el usuario sube un PDF/texto (o pega una URL, vía Firecrawl que ya está en el stack). El paso extrae el texto, lo trocea en fragmentos (~500-1000 tokens), genera embeddings y los guarda en Postgres.
2. **"Buscar en base de conocimiento"**: convierte la consulta en embedding, busca los fragmentos más parecidos (top-k, distancia coseno) y los devuelve al flujo para que el LLM responda con ese contexto.

Para el usuario del workflow se ve tan simple como leer un dato de Sheets; la complejidad (chunking, embeddings, búsqueda vectorial) queda encapsulada una sola vez en el plugin.

## Decisiones pendientes (de Leo)

### 1. Dónde guardar los vectores

| Opción | Detalle | Costo | Notas |
|---|---|---|---|
| **a) pgvector en la misma Neon (recomendada)** | Extensión oficial soportada; mismas migraciones Drizzle de siempre | $0 | Free tier Neon: 0.5 GB almacenamiento (decenas de miles de fragmentos; de sobra para demo y uso chico/mediano) |
| b) Supabase con pgvector | Proyecto nuevo | $0 | Duplica base de datos y conexiones al pedo |
| c) Vector DB dedicado (Pinecone/Qdrant Cloud) | Capas gratis | $0 inicial | Otro servicio + SDK + secretos; solo si el volumen explota |

### 2. Proveedor de embeddings

| Opción | Detalle | Costo |
|---|---|---|
| **a) OpenAI text-embedding-3-small vía Vercel AI Gateway (recomendada)** | Ya está en el catálogo del Gateway: funciona con el `AI_GATEWAY_API_KEY` existente, sin cuenta nueva | US$0.02 por millón de tokens (indexar varios MB cuesta centavos) |
| b) Gemini embedding (AI Studio) | Consistente con filosofía gasto-cero; el chat ya usa Gemini | Capa gratuita con rate limits (puede molestar al subir muchos documentos seguidos) |

**Costo total estimado:** $0/mes con opción Gemini free + Neon actual; centavos/mes con OpenAI.

## Librerías open source (recomendación: piezas chicas, no framework completo)

1. **Embeddings: Vercel AI SDK v5** (`ai` ^5.0.102, **ya instalada**) — `embed`/`embedMany` hablan con el AI Gateway. Cero dependencias nuevas.
2. **Chunking: `@langchain/textsplitters`** (paquete standalone de LangChain.js, `RecursiveCharacterTextSplitter`). Única pieza de LangChain a usar; no arrastra el framework.
3. **Parser de PDF: `unpdf`** (wrapper liviano de pdf.js, pensado para serverless/edge, mantenido por UnJS). `pdf-parse` quedó vieja; `pdfjs-dist` completo es demasiado pesado para solo extraer texto. URLs: ya tenemos Firecrawl.
4. **Vectores/retrieval: drizzle-orm 0.44 (ya instalada)** soporta pgvector nativamente (columnas `vector`/`halfvec`, distancia coseno). El nodo de búsqueda es ~20 líneas de SQL con el ORM de siempre. No hace falta LlamaIndex PGVectorStore ni clientes nuevos.

**Frameworks completos (LangChain.js, LlamaIndex.TS): no recomendados para esto.** Pesados, árboles de dependencias grandes, abstracciones que chocan con el modelo de plugins. Reevaluar solo si se quieren loaders de muchos formatos (Word, HTML, CSV) o retrieval avanzado (búsqueda híbrida, reranking).

**Resumen:** 2 dependencias nuevas chicas (`@langchain/textsplitters` + `unpdf`) y lo demás ya está instalado.

## Esfuerzo estimado

1-2 días: migración Drizzle (tabla documentos/fragmentos con columna vectorial + índice), plugin nuevo con los 2 pasos, parser de PDF, wiring en el builder. No toca arquitectura.

## Fuentes (2026-10-20)

- https://neon.com/docs/extensions/pgvector — pgvector soportado en Neon
- https://developers.openai.com/api/docs/models/text-embedding-3-small — $0.02 / 1M tokens
- https://vercel.com/ai-gateway/models/text-embedding-3-small — disponible en Vercel AI Gateway
- https://ai.google.dev/gemini-api/docs/rate-limits — rate limits capa gratuita Gemini
- https://ai-sdk.dev/docs/reference/ai-sdk-core/embed-many — AI SDK embedMany
- https://www.pkgpulse.com/guides/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-2026 — comparativa parsers PDF

## Workaround MVP (sin RAG)

Para "soporte con base de conocimiento" alcanza con: nodo Composio que lee un Google Doc (o Sheets/Notion) entero + paso LLM que recibe ese contenido completo como contexto. Sirve para bases chicas (un doc entra en la ventana de contexto); RAG pasa a ser necesario recién cuando la base no entra entera en el prompt.
