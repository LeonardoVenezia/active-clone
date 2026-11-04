# Manual editor regression (offline)

Run `node evals/manual-ux/run.cjs` from the repository root. Requires installed dependencies and Chrome at `/usr/bin/google-chrome`.

Mounts the real `Home` and `PanelInner` with the real Jotai state, ActionGrid, ActionConfig, and api-client. Auth/session, router and HTTP responses are fixtures. All external requests are blocked. Monaco is replaced with a textarea because its CDN loader is outside this regression. No Postgres, production session, model, executor, or backend behavior is tested. No production CSS is loaded: the screenshot is functional evidence, not visual QA.

Checks fresh creation against a populated prior editor, exact one creation, explicit/no organization, StrictMode, delayed session, action selection defaults, field edits, PATCH payload, alternative/existing operations and honest legacy missing-operation rendering. The original ten-check regression reproduced five baseline failures. The expanded sixteen-check regression also tests StrictMode and delayed session independently; see captured logs for per-check results. Prepared branch passes all sixteen. The backend still rejects missing operations. Existing configs are never silently migrated.

The production browser observations are separately recorded in Trello card GNjAIwm4. The local fix is not deployed and does not certify production behavior after release.
