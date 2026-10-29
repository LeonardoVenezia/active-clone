# Company dashboard sprint

Root now lists the authenticated user's organizations and supports creating one through the existing Better Auth organization API. Each company lists only explicitly scoped workflows that the user already owns or can open through an explicit share. New contextual workflows and their management scope are written in one transaction. Existing workflows are not reassigned; console assignments are not treated as editor ownership.

Production prerequisite: sql/management-workflow-scopes.sql. It creates empty additive tables only. No feature flags for company variables should be enabled yet. Storage helpers encrypt all values and exclude values from metadata, but the public permission policy, console UI and runtime wiring are unfinished and remain closed.

Local checks: complete TypeScript, company references unit test, real PostgreSQL membership/scope/storage tests, Better Auth plus real management pages at390px, full optimized webpack build with workflow transform, real console proxy/manual-trigger-only runtime202→success→idempotent replay. No provider actions, emails or model calls. Local workflow world is embedded, not local. Production canRun remains false.

Build resource diagnosis: the workflow discovery esbuild service stays resident after discovery. On a2GB local machine, terminating that idle child after discovery allowed the full optimized build to finish with a1GB worker heap. Temporary memory/worker/ignoreBuildErrors QA settings were restored. TypeScript passed separately. Delivered next.config retains the original workflow wrapper and checks.
