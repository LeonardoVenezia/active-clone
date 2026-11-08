import { readFileSync, writeFileSync } from "node:fs";
import postcss from "/tmp/ac/node_modules/.pnpm/@tailwindcss+postcss@4.1.16/node_modules/postcss/lib/postcss.mjs";
import tailwind from "@tailwindcss/postcss";

const css = readFileSync("/tmp/ac/app/globals.css", "utf8");
const result = await postcss([
  tailwind({ base: "/tmp/ac", optimize: false }),
]).process(css, { from: "/tmp/ac/app/globals.css" });
writeFileSync("/tmp/panel.css", result.css);
console.log("panel.css bytes:", result.css.length);
