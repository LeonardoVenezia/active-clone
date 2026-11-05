# Export syntax verification

From the repository root, with the existing project dependencies available:

```sh
node --import tsx scripts/discover-plugins.ts
node --import tsx --test evals/export-syntax/names.test.mts
node evals/export-syntax/verify-surfaces.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The views harness mounts the real panel and overlay, with auth/navigation/editor stubs. It compares their code to the real download GET handler's output using a mocked session and record. All nonlocal browser requests are blocked. The export contains only a manual trigger. Screenshots and generated files go to `/downloads/export-after-warnings-numeric-*`.

This proves binding consistency and the tested syntax cases. It does not execute exported workflows, validate a complete downloaded project, test live providers, or remove deliberate unsupported-node guards. The stylesheet is optional: `/tmp/manual-ux-globals.css` from the prior local UI harness is used when present.
