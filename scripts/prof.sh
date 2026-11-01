#!/bin/bash
# usage: scripts/prof.sh scripts/file.ts
npx esbuild $1 --bundle --platform=node --format=esm --outfile=/tmp/claude-0/prof.mjs --log-level=error
rm -rf /tmp/claude-0/prof/*; mkdir -p /tmp/claude-0/prof
(cd /tmp/claude-0 && node --cpu-prof --cpu-prof-dir=/tmp/claude-0/prof prof.mjs | tail -${2:-3})
python3 - <<'PY'
import json,glob,collections
f=glob.glob('/tmp/claude-0/prof/*.cpuprofile')[0]
p=json.load(open(f))
nodes={n['id']:n for n in p['nodes']}
self_t=collections.Counter()
for s,d in zip(p['samples'],p['timeDeltas']):
    cf=nodes[s]['callFrame']
    self_t[(cf['functionName'] or '(anon)')+':'+str(cf['lineNumber'])]+=d
tot=sum(self_t.values())
print('total ms', tot/1000)
for k,v in self_t.most_common(16): print(f"{v/tot*100:5.1f}% {k}")
PY
