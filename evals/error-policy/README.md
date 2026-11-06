# Shared node error policy (local verification)

Run from the repository root:

```sh
NODE_OPTIONS=--max-old-space-size=1500 pnpm type-check
node evals/error-policy/run.cjs
node evals/manual-ux/styles.cjs
python3 evals/error-policy/run-ui.py
node --import tsx --test evals/error-policy/export.test.mts evals/export-syntax/names.test.mts
node evals/error-policy/verify-surfaces.cjs
node evals/export-syntax/verify-surfaces.cjs
```

`config.onError` accepts `stop` or `continue`. It is inherited by all plugins through the executor and editor, not implemented per plugin. Deliberate action selection starts with `stop` unless an explicit `continue` was already chosen. Missing/unknown values on reload preserve existing workflows rather than silently migrating them. The editor displays that state as a disabled placeholder, with only two new selectable policies.

- Stop blocks descendants of the failed node. It does not cancel or undo other branches.
- Continue releases descendants with an explicit `{success:false,error}` output. A failed run remains failed. Existing failure data, including Loop and Unir diagnostics, is retained.
- A false Condition is still filtering, not failure.
- Approval failure/rejection never releases its protected descendants, regardless of the policy. The company-variable execution guard remains outside node continuation handling.
- Loop without an explicit policy keeps its legacy continue-per-item behavior. Explicit stop ends iteration at the first failed inner step; explicit continue tries later inner steps and items. Both retain item failures and make the Loop/run failed. With an explicit policy, an approval refusal ends the Loop and blocks outer descendants. Legacy Loop refusal handling is not migrated.
- Unir with no explicit policy preserves its stored onParentFailure/onTimeout choices. With an explicit policy those stored controls are disabled and overridden. Partial failure/timeout stays a failed join with its diagnostics even when continuation is allowed. Missing all inputs is never a successful join.
- Both export generators use the same generated graph runner when any node has an explicit policy. Returned and thrown failures are recorded, continuation releases descendants without making the run successful, false Conditions filter descendants, disabled nodes bypass, and Approval failures block descendants. Exported workflows in this mode return `{success,results,outputs}`. Their prior behavior is unchanged without an explicit policy.
- The preexisting platform-only limits for Datos/Frontend and Unir remain. Loop had no executable export implementation; the policy path refuses before effects instead of emitting a successful placeholder. This is a node-type export limit, not a blanket error-policy restriction. No Datos-in-Loop support is added.

The executor harness bundles the real executor and real template/condition/field/policy helpers. Provider imports, database logging and durable runtime functions are replaced with local stubs. It checks returned outputs, descendant execution, completion status, joins and refusal handling. It does not execute real workflows or validate provider behavior or durable-runtime replay.

The UI harness mounts real components and uses the existing offline baseline fixture. It blocks nonlocal requests and checks real state and mocked save payloads. Screenshots are local rendered UI, not production. These checks do not verify a production deployment.

The export tests transpile and execute emitted code from both generators in isolated local contexts. HTTP, sleeps and approval hooks are mocked. They check thrown/returned failures, stop/continue, error-template interpolation and quoted JSON, Condition consumption of error outputs, Approval rejection, parallel/merged branches, disabled nodes, invalid Delay, unknown actions and preexisting unsupported-node guards. They do not validate live providers, a deployed downloaded project, or durable-runtime replay. The surface harness compares real mounted panel/overlay output with the real download GET handler using a mocked record containing an explicit policy.
