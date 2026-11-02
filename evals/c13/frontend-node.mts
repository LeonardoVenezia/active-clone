// @ts-nocheck
const m: any = await import("../../lib/datos/frontend"); const { frontendViewFromNodes, decideWorkflowOrg, authorizeFrontendRun } = m.default ?? m;
let fails = 0; const ok = (c: boolean, msg: string) => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} ${msg}`); };
const node = (config: any) => ({ id: "f", data: { config } });
{ const v = frontendViewFromNodes([node({ actionType: "Condition" }), node({ actionType: "Frontend", title: " Stock ", collection: "sku" })]); ok(v?.title === "Stock" && v.collection === "sku" && v.showRun === true, "F1 view read from the Frontend node (title trimmed, run button on by default)"); }
{ ok(frontendViewFromNodes([node({ actionType: "Frontend", collection: "sku", showRun: "false" })])?.showRun === false, "F2 showRun=false hides the button"); }
for (const [c, why] of [[undefined, "missing"], ["", "empty"], ["Sku", "uppercase"], ["a b", "space"], ["../x", "path"], ["a".repeat(41), "long"], [5, "number"]] as const) ok(frontendViewFromNodes([node({ actionType: "Frontend", collection: c })]) === null, `F3 invalid collection gives no view (${why})`);
ok(frontendViewFromNodes([node({ actionType: "Datos", collection: "sku" })]) === null && frontendViewFromNodes(null) === null && frontendViewFromNodes("x") === null, "F4 no Frontend node / bad input gives no view");
ok(frontendViewFromNodes([node({ actionType: "Frontend", collection: "sku", title: "x".repeat(200) })]).title.length === 80, "F5 title capped at 80");
const good = { signedIn: true, anonymous: false, workflowExists: true, isOwner: true, hasShare: false, scopeOrganizationId: "org1", isMemberOfScopeOrg: true };
ok(decideWorkflowOrg(good) === "org1", "A1 owner + member of the scope organization: allowed, organization from the scope");
ok(decideWorkflowOrg({ ...good, isOwner: false, hasShare: true }) === "org1", "A2 shared user who is a member: allowed");
for (const [k, v, why] of [["signedIn", false, "no session"], ["anonymous", true, "anonymous user"], ["workflowExists", false, "unknown workflow"], ["isOwner", false, "not owner and no share"], ["scopeOrganizationId", null, "workflow has no organization scope"], ["isMemberOfScopeOrg", false, "not a member of the organization"]] as const)
  ok(decideWorkflowOrg({ ...good, [k]: v }) === null, `A3 denied: ${why}`);
ok(decideWorkflowOrg({ ...good, isOwner: false, hasShare: true, isMemberOfScopeOrg: false }) === null, "A4 shared but not a member of the organization: denied (a share alone is not enough)");
const nodesOk = [node({ actionType: "Frontend", collection: "sku" })]; const O = "https://app.example";
const run = (over: any = {}, nodes: any = nodesOk, origin: any = O) => authorizeFrontendRun({ facts: { ...good, ...over }, nodes, requestOrigin: origin, urlOrigin: O });
ok(run().ok === true && run().organizationId === "org1", "R1 Frontend run allowed: signed-in owner who is a member, button on, same origin");
ok(run({ isOwner: false, hasShare: true }).ok === true, "R2 shared user who is a member: allowed");
{ const d = run({ signedIn: false }); ok(!d.ok && d.status === 401, "R3 direct POST without session: 401"); }
{ const d = run({ anonymous: true }); ok(!d.ok && d.status === 401, "R4 anonymous session: 401"); }
{ const d = run({ isMemberOfScopeOrg: false }); ok(!d.ok && d.status === 403, "R5 user outside the organization: 403"); }
{ const d = run({ isOwner: false, hasShare: true, isMemberOfScopeOrg: false }); ok(!d.ok && d.status === 403, "R6 shared without membership: 403 (the Frontend action does not just inherit the share)"); }
{ const d = run({ isOwner: false, hasShare: false }); ok(!d.ok && d.status === 403, "R7 neither owner nor shared: 403"); }
{ const d = run({ scopeOrganizationId: null }); ok(!d.ok && d.status === 403, "R8 workflow without organization scope: 403"); }
{ const d = run({}, nodesOk, "https://evil.example"); ok(!d.ok && d.status === 403, "R9 cross-origin POST: 403"); }
{ const d = run({}, nodesOk, null); ok(!d.ok && d.status === 403, "R10 POST with no Origin header: 403"); }
{ const d = run({}, [node({ actionType: "Frontend", collection: "sku", showRun: "false" })]); ok(!d.ok && d.status === 404, "R11 Ejecutar button off: the run is refused on the server, not only hidden"); }
{ const d = run({}, [node({ actionType: "Condition" })]); ok(!d.ok && d.status === 404, "R12 workflow without a Frontend node: refused"); }
{ const d = run({}, [node({ actionType: "Frontend", collection: "../x" })]); ok(!d.ok && d.status === 404, "R13 invalid Frontend config: refused"); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
