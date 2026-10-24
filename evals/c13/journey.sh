#!/bin/bash
# usage: journey.sh "turn1" "turn2" ...  (live, free Gemini, strict). prints each turn.
echo '[]' > /tmp/past.json
for U in "$@"; do
  for try in 1 2 3; do
    OUT=$(npx tsx unified-live.mts "$U" /tmp/past.json 2>&1); echo "$OUT" | grep -q '^ERR: -' && break; sleep 20
  done
  T=$(echo "$OUT" | sed -n '/^TEXT:/,/^RESULT:/p' | sed '1s/^TEXT: //;$d')
  echo "USER: $U"; echo "$OUT" | grep -E '^(TEXT|RESULT|ERR)' -A4 | grep -v '^TRACE' | head -14
  node -e 'const f="/tmp/past.json";const p=JSON.parse(require("fs").readFileSync(f));p.push({role:"user",content:process.argv[1]},{role:"assistant",content:process.argv[2]});require("fs").writeFileSync(f,JSON.stringify(p))' "$U" "$T"
  echo ------
done
