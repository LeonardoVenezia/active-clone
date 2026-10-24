// Offline pure-function tests for description parsing (no network, no server-only).
const m: any = await import("../../lib/text/description"); const { htmlToText, pickLocalized, limitWithNotice, tiendanubeDescription, mlDescription, DESCRIPTION_MAX_CHARS } = m.default ?? m;
const r: [string, boolean][] = [];
const t = (n: string, ok: boolean) => r.push([n, ok]);
t("html basic", htmlToText("<p>Hola <b>mundo</b></p><p>Segunda</p>") === "Hola mundo\nSegunda");
t("br + entities", htmlToText("A&nbsp;B<br/>C &amp; D &lt;x&gt; &#233; &#x41;") === "A B\nC & D <x> é A");
t("script/style removed", htmlToText("<style>a{}</style>x<script>alert(1)</script>y") === "xy");
t("unknown entity kept", htmlToText("&foo;") === "&foo;");
t("invalid numeric entity kept", htmlToText("&#99999999;") === "&#99999999;");
t("list items", htmlToText("<ul><li>uno</li><li>dos</li></ul>") === "uno\ndos");
t("empty", htmlToText("") === "" && tiendanubeDescription(null).text === "" && tiendanubeDescription(undefined).truncated === false);
t("localized es preferred", pickLocalized({ pt: "p", es: "e", en: "n" }) === "e");
t("localized falls to pt when es blank", pickLocalized({ es: " ", pt: "p" }) === "p");
t("localized any other lang", pickLocalized({ fr: "f" }) === "f");
t("localized plain string / junk", pickLocalized("x") === "x" && pickLocalized(42) === "" && pickLocalized([]) === "");
t("tn end to end", tiendanubeDescription({ es: "<p>Remera <i>algodón</i></p>" }).text === "Remera algodón");
const big = "a".repeat(DESCRIPTION_MAX_CHARS + 5);
const l = limitWithNotice(big);
t("limit exact not truncated", !limitWithNotice("a".repeat(DESCRIPTION_MAX_CHARS)).truncated);
t("limit truncates with notice + flag + length", l.truncated && l.originalLength === big.length && l.text.includes("recortada") && l.text.includes(String(big.length)));
t("ml plain_text", mlDescription({ plain_text: "Hola  \nChau  \n" }).text === "Hola\nChau");
t("ml missing/malformed", mlDescription(null).text === "" && mlDescription({ plain_text: 3 }).text === "" && mlDescription("x").text === "");
let f = 0; for (const [n, ok] of r) { console.log(ok ? "PASS" : "FAIL", n); if (!ok) f++; }
console.log(`${r.length - f}/${r.length}`); process.exit(f ? 1 : 0);
