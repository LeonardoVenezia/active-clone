const fs=require('node:fs');
const postcss=require('../../node_modules/.pnpm/postcss@8.5.6/node_modules/postcss');
const tailwind=require('@tailwindcss/postcss');
(async()=>{const out=await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:require('node:path').resolve('app/globals.css')});fs.writeFileSync('/tmp/manual-ux-globals.css',out.css);})();
