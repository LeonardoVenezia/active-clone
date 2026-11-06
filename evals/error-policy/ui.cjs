// Run the real-component baseline harness with error-policy checks added before its final error assertion.
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const filename = path.resolve("evals/manual-ux/run.cjs");
const extra = '  await page.goto(`${base}/?mode=panel`);\n  await page.evaluate(() => window.qa.loadConfig({actionType:"Datos",collection:"legacy",key:"k"}));\n  const policy = page.getByLabel("Si este paso falla", {exact:true});\n  await policy.waitFor();\n  ok("legacy config not silently given an error policy", !(await page.evaluate(() => window.qa.state())).nodes[0].data.config.onError);\n  ok("legacy policy is labeled without claiming stop", await policy.inputValue() === "legacy");\n  await policy.selectOption("continue");\n  ok("common policy persists in real store", (await page.evaluate(() => window.qa.state())).nodes[0].data.config.onError === "continue");\n  await page.evaluate(() => window.qa.save());\n  ok("common policy is included in PATCH payload", patches.at(-1).nodes[0].data.config.onError === "continue");\n  for (const actionType of ["Datos","Loop","Unir"]) {\n    await page.evaluate((actionType) => window.qa.loadConfig({actionType,onError:"continue",joinMode:"timeout",timeoutSeconds:"5",onParentFailure:"fail",onTimeout:"fail"}), actionType);\n    await policy.waitFor();\n    await policy.scrollIntoViewIfNeeded();\n    ok(`${actionType} inherits common policy`, await policy.inputValue() === "continue");\n    if (actionType === "Unir") ok("Unir legacy controls disabled while explicit common policy applies", await page.locator("#unir-fail").isDisabled() && await page.locator("#unir-timeout").isDisabled());\n    await page.screenshot({path:`/downloads/error-policy-${actionType}-1280.png`, fullPage:true});\n  }\n  await policy.selectOption("stop");\n  ok("explicit stop selected without changing legacy Unir fields", (await page.evaluate(() => window.qa.state())).nodes[0].data.config.onParentFailure === "fail" && (await page.evaluate(() => window.qa.state())).nodes[0].data.config.onError === "stop");\n  await page.setViewportSize({width:390,height:844});\n  await policy.scrollIntoViewIfNeeded();\n  await page.screenshot({path:"/downloads/error-policy-mobile.png",fullPage:true});\n';
const source = fs.readFileSync(filename,"utf8")
  .replace('  ok("no browser runtime errors", errors.length === 0);', extra + '  ok("no browser runtime errors", errors.length === 0);')
  .replace("/tmp/manual-ux-results.json", "/tmp/error-policy-ui-results.json")
  .replace("esbuild.buildSync({", "await esbuild.build({")
  .replace("(async () => {", "await (async () => {")
  .replace("esbuild.stop();", "await esbuild.stop();");
const child = new Module(filename, module);
child.filename = filename;
child.paths = Module._nodeModulePaths(path.dirname(filename));
child._compile("(async () => {\n" + source + "\n})().catch(e => { console.error(e); process.exitCode=1; });", filename);
