// compose.html 의 SUBS 를 .srt 로 뽑는다
import fs from 'node:fs';
const html = fs.readFileSync(new URL('./compose.html', import.meta.url), 'utf8');
const subs = eval(html.match(/const SUBS = (\[[\s\S]*?\n\]);/)[1]);
const ts = s => { const ms = Math.round(s * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms/3600000))}:${p(Math.floor(ms/60000)%60)}:${p(Math.floor(ms/1000)%60)},${p(ms%1000,3)}`; };
console.log(subs.map(([a, b, t], i) => `${i+1}\n${ts(a)} --> ${ts(b)}\n${t}\n`).join('\n'));
