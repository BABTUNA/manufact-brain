// Composes the Manufact Brain asset files. The mark is a brain drawn as a small graph: seven
// nodes joined by edges, two lobes, the shape agents share. The words are Archivo 800
// outlines from paths.json (python3 extract.py), so no font is needed anywhere.
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync('paths.json', 'utf8'));
const OUT = process.argv[2] || '..';
// Violet on ink and paper.
const C = { violet: '#6B5CFF', violetDeep: '#5546E0', violetInk: '#4A3BD6', violetSoft: '#E9E6FF', violetLight: '#B9B1FF', ink: '#111318', paper: '#F5F6F8', white: '#FFFFFF', slate: '#646B78', line: '#E2E5EB' };
fs.mkdirSync(`${OUT}/logo`, { recursive: true });

// The node brain in a 512 box: two lobes of nodes, edges between neighbours.
const N = { a: [176, 168], b: [336, 168], c: [120, 296], d: [256, 270], e: [392, 296], f: [196, 404], g: [316, 404] };
const E = [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'd'], ['b', 'e'], ['c', 'd'], ['d', 'e'], ['c', 'f'], ['d', 'f'], ['d', 'g'], ['e', 'g'], ['f', 'g']];
const R = 38, W = 20;
function brain(c) {
  const edges = E.map(([p, q]) => `<line x1="${N[p][0]}" y1="${N[p][1]}" x2="${N[q][0]}" y2="${N[q][1]}"/>`).join('');
  const nodes = Object.values(N).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${R}"/>`).join('');
  return `<g stroke="${c.edge}" stroke-width="${W}" stroke-linecap="round">${edges}</g>\n    <g fill="${c.node}">${nodes}</g>${c.core ? `\n    <circle cx="${N.d[0]}" cy="${N.d[1]}" r="${R - 14}" fill="${c.core}"/>` : ''}`;
}
const VIOLET = { node: C.violet, edge: C.violetDeep, core: C.white };
const ON_INK = { node: C.violetLight, edge: C.violet, core: C.ink };
const ON_VIOLET = { node: C.white, edge: C.violetSoft, core: C.violet };
const mono = () => `<g fill="currentColor" stroke="currentColor" stroke-width="${W}" stroke-linecap="round">${E.map(([p, q]) => `<line x1="${N[p][0]}" y1="${N[p][1]}" x2="${N[q][0]}" y2="${N[q][1]}"/>`).join('')}${Object.values(N).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${R}" stroke="none"/>`).join('')}</g>`;

const svgHead = (w, h, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">`;
const write = (file, w, h, label, comment, body) => fs.writeFileSync(`${OUT}/logo/${file}`, `${svgHead(w, h, label)}\n  <!-- ${comment} -->\n  ${body}\n</svg>\n`);
const placed = (body, x, y, k) => `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})">${body}</g>`;
const word = (text, x, baseline, capH, fill) => {
  const k = capH / P.capH;
  return { svg: `<path d="${P[text].d}" fill="${fill}" transform="translate(${x.toFixed(2)} ${baseline.toFixed(2)}) scale(${k.toFixed(4)})"/>`, width: P[text].adv * k, space: P.space * k };
};

// --- marks ---
write('manufactbrain-mark.svg', 512, 512, 'Manufact Brain mark', 'Primary mark: the node brain in violet. Works on white and paper.', brain(VIOLET));
write('manufactbrain-mark-dark.svg', 512, 512, 'Manufact Brain mark', 'For ink or dark surfaces: lighter violet nodes.', brain(ON_INK));
write('manufactbrain-mark-on-violet.svg', 512, 512, 'Manufact Brain mark', 'For the violet field: white nodes.', brain(ON_VIOLET));
write('manufactbrain-mark-mono.svg', 512, 512, 'Manufact Brain mark', 'Single colour. Set color on the parent.', mono());

// --- wordmarks: mark (340 tall) + Manufact Brain ---
let geom;
{
  const k = 340 / 512, capH = 128, H = 512, markX = -20 * k, markY = (H - 340) / 2 + 6, baseline = 340;
  const textX = 470 * k + markX + 28;
  const build = (file, c, text, accent, comment) => {
    const w1 = word('Manufact', textX, baseline, capH, text);
    const w2 = word('Brain', textX + w1.width + w1.space, baseline, capH, accent);
    const totalW = Math.ceil(textX + w1.width + w1.space + w2.width + 8);
    geom = { totalW, H };
    write(file, totalW, H, 'Manufact Brain', comment, placed(brain(c), markX, markY, k) + '\n  ' + w1.svg + '\n  ' + w2.svg);
  };
  build('manufactbrain-wordmark.svg', VIOLET, C.ink, C.violet, 'Wordmark for white or light surfaces. All outlined, no font needed.');
  build('manufactbrain-wordmark-dark.svg', ON_INK, C.paper, C.violetLight, 'Wordmark for ink or dark surfaces.');
  build('manufactbrain-wordmark-on-violet.svg', ON_VIOLET, C.white, C.ink, 'Wordmark for the violet field.');
  fs.writeFileSync('wordmark-geom.json', JSON.stringify(geom));
}

// --- app icons (512 tile, mark at 78%) ---
{
  const k = 0.78, x = (512 - 512 * k) / 2, y = (512 - 512 * k) / 2;
  const tile = (file, bg, c, comment) => write(file, 512, 512, 'Manufact Brain', comment, `<rect width="512" height="512" rx="112" fill="${bg}"/>\n  ${placed(brain(c), x, y, k)}`);
  tile('manufactbrain-icon.svg', C.paper, VIOLET, 'App icon: paper tile, violet brain.');
  tile('manufactbrain-icon-dark.svg', C.ink, ON_INK, 'App icon, ink tile.');
  tile('manufactbrain-icon-violet.svg', C.violet, ON_VIOLET, 'App icon, violet tile: white brain.');
}

// --- render pages ---
const read = f => fs.readFileSync(`${OUT}/logo/${f}`, 'utf8').replace(/<svg[^>]*>/, m => m.replace(/width="\d+" height="\d+"/, ''));
const page = (title, body, css) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&family=Onest:wght@500&display=swap">\n<style>html,body{margin:0}${css}</style></head><body>${body}</body></html>\n`;
const TAGLINE = 'Notes about any website that agents read before they browse, and write to after.';
const banner = (file, wm, bg, grid, tag) => fs.writeFileSync(file, page('Manufact Brain banner', `<div class="b"><div class="wm">${read(wm)}</div><p>${TAGLINE}</p></div>`,
  `body{background:${bg}} .b{width:1280px;height:640px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;position:relative;overflow:hidden}
   .b:before{content:"";position:absolute;inset:0;background-image:radial-gradient(${grid} 1.5px,transparent 1.5px);background-size:28px 28px}
   .b:after{content:"";position:absolute;left:0;right:0;bottom:0;height:8px;background:${C.violet}}
   .wm{position:relative;width:820px} .wm svg{width:100%;height:auto;display:block}
   p{position:relative;margin:0;font:500 24px Onest,sans-serif;color:${tag}}`));
banner('banner.html', 'manufactbrain-wordmark.svg', C.paper, 'rgba(17,19,24,.08)', C.slate);
banner('banner-dark.html', 'manufactbrain-wordmark-dark.svg', C.ink, 'rgba(245,246,248,.08)', '#A7ADB8');
const bare = (file, svg, css) => fs.writeFileSync(file, page('Manufact Brain', svg, `body{background:transparent} ${css}`));
bare('icon.html', read('manufactbrain-icon.svg'), 'svg{width:100vw;height:100vh;display:block}');
for (const [f, s] of [['wordmark.html', 'manufactbrain-wordmark.svg'], ['wordmark-dark.html', 'manufactbrain-wordmark-dark.svg']])
  bare(f, `<div class="w">${read(s)}</div>`, `.w{width:${geom.totalW / 2}px} svg{width:100%;height:auto;display:block}`);

// contact sheet
const cell = (bg, inner, cap) => `<div class="card"><div class="cell" style="background:${bg}">${inner}</div><small>${cap}</small></div>`;
const sw = (hex, name, use) => `<div class="sw"><i style="background:${hex}"></i><b>${name}</b><span>${hex}</span><span>${use}</span></div>`;
fs.writeFileSync('sheet.html', page('Manufact Brain logo sheet',
  `<div class="sheet"><h2>Palette · Violet</h2><div class="row">
    ${sw(C.violet, 'Violet', 'nodes, "Brain", fills, dots')}${sw(C.violetInk, 'Violet ink', 'buttons, violet text')}${sw(C.violetSoft, 'Violet soft', 'tints')}${sw(C.violetLight, 'Violet light', 'on ink')}${sw(C.ink, 'Ink', 'text, dark surfaces')}${sw(C.paper, 'Paper', 'page background')}${sw(C.slate, 'Slate', 'muted text')}
  </div><h2>Marks · assets/logo</h2><div class="row">
    ${cell(C.white, read('manufactbrain-mark.svg'), 'manufactbrain-mark.svg · primary')}
    ${cell(C.ink, read('manufactbrain-mark-dark.svg'), 'manufactbrain-mark-dark.svg · on ink')}
    ${cell(C.violet, read('manufactbrain-mark-on-violet.svg'), 'manufactbrain-mark-on-violet.svg · on violet')}
    ${cell(C.paper, `<div style="color:${C.ink};width:220px;height:220px">${read('manufactbrain-mark-mono.svg')}</div>`, 'manufactbrain-mark-mono.svg · one colour')}
  </div><h2>Icons · assets/icons</h2><div class="row"><div class="card"><div class="strip">
    <img src="../icons/icon-512.png" width="160" height="160"><img src="../icons/icon-256.png" width="128" height="128"><img src="../icons/icon-128.png" width="96" height="96"><img src="../icons/icon-48.png" width="48" height="48"><img src="../icons/icon-32.png" width="32" height="32"><img src="../icons/icon-16.png" width="16" height="16">
  </div><small>icon-512 · 256 · 128 · 48 · 32 · 16</small></div>
    ${cell(C.paper, `<div style="width:160px;height:160px">${read('manufactbrain-icon-dark.svg')}</div>`, 'manufactbrain-icon-dark.svg')}
    ${cell(C.paper, `<div style="width:160px;height:160px">${read('manufactbrain-icon-violet.svg')}</div>`, 'manufactbrain-icon-violet.svg')}
  </div><h2>Wordmarks · assets/logo and assets/banner</h2><div class="row">
    ${cell(C.white, `<div style="width:88%">${read('manufactbrain-wordmark.svg')}</div>`, 'manufactbrain-wordmark.svg · primary')}
    ${cell(C.ink, `<div style="width:88%">${read('manufactbrain-wordmark-dark.svg')}</div>`, 'manufactbrain-wordmark-dark.svg · on ink')}
    ${cell(C.violet, `<div style="width:88%">${read('manufactbrain-wordmark-on-violet.svg')}</div>`, 'manufactbrain-wordmark-on-violet.svg · on violet')}
  </div></div>`,
  `body{background:#ECEEF2;font-family:"JetBrains Mono",monospace;color:${C.slate}} .sheet{width:1600px;box-sizing:border-box;padding:40px;display:flex;flex-direction:column;gap:24px}
   h2{font:600 11px "JetBrains Mono",monospace;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 -8px;color:${C.violetInk}}
   .row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start} .card{display:flex;flex-direction:column;gap:8px;align-items:center}
   .card small{font-size:11px;text-align:center;max-width:360px} .cell{width:360px;height:240px;border-radius:12px;border:1px solid ${C.line};display:flex;align-items:center;justify-content:center}
   .cell>svg{width:200px;height:200px} .cell div svg{width:100%;height:auto;display:block}
   .strip{display:flex;gap:20px;align-items:flex-end;padding:24px;height:192px;box-sizing:content-box;border-radius:12px;border:1px solid ${C.line};background:${C.white}} img{display:block}
   .sw{display:flex;flex-direction:column;gap:4px;font-size:11px;width:200px} .sw i{height:72px;border-radius:10px;border:1px solid #0001} .sw b{color:${C.ink};font-weight:600;margin-top:4px}`));
console.log('composed', geom);
