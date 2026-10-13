import HeliosNetwork, { AttributeType } from 'helios-network';
import { Helios, HeliosUI } from 'helios-web';

import { createChecklist, createHoverCard, createSearch, createSegmented, createSlider, el } from './ui-controls.js';
import './styles.css';

// Hierarchical map: a bisecting k-means tree per field (depth up to 7); zooming in opens a node into its two
// children. Positions are fixed t-SNE coordinates (2D or 3D) of the joint space in which management is translated
// onto multi-agent AI.

const viewer = document.querySelector('#viewer');
const DIM3 = new URLSearchParams(location.search).get('dim') === '3';

const LABEL = 'Label';
const CORPUS = 'CorpusId';
const COLOR_ID = 'ColorId'; // tree-node index, or DIM / HIDDEN
const DIM = 100;
const HIDDEN = 101;
const POSITION = '_helios_visuals_position';

const CORPUS_NAMES = ['Management', 'Multi-agent AI'];
const DIM_COLOR = [0.3, 0.3, 0.3, 0.35];
const HIDDEN_COLOR = [0, 0, 0, 0];
// Clusters overlap in the map, so their spread says little about depth; levels open by zoom instead. A node splits
// into its children once the map is magnified, relative to the framed whole map, by at least OPEN_AT[child depth].
const OPEN_AT = [0, 0, 1.7, 3, 5.5, 9, 15, 25];

let data = null; // { title, arxiv, year, corpus } from map-data.json plus hier-data.json
let nodes = [];
let children = [];
let dfs = []; // node indices in depth-first order, so tree neighbours are neighbours here
let dfsRank = [];
let lowerTitles = [];

const state = { search: '', corpora: new Set([0, 1]), colorMode: 'auto', nodeOpacity: 0.85, nodeSize: DIM3 ? 0.25 : 1.6, shown: [] };

const setStatus = (message) => { viewer.dataset.status = message ?? ''; };

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

// Children split the parent's hue interval in two, so a branch stays recognisable at every depth.
function assignColors() {
  const ranges = { 0: [185, 275], 1: [-5, 55] };
  nodes.forEach((n) => { n.color = null; });
  const walk = (i, lo, hi, light) => {
    const mid = (lo + hi) / 2;
    nodes[i].color = [...hslToRgb(((mid % 360) + 360) % 360, 0.72, light), 1];
    nodes[i].labelColor = hslToRgb(((mid % 360) + 360) % 360, 0.85, 0.74);
    children[i].forEach((c, k) => walk(c, k === 0 ? lo : mid, k === 0 ? mid : hi, Math.max(0.38, Math.min(0.7, light + (k === 0 ? 0.06 : -0.06)))));
  };
  nodes.forEach((n, i) => { if (n.parent < 0) walk(i, ...ranges[n.corpus], 0.54); });
  nodes.forEach((n) => { if (n.parent < 0) n.color = n.corpus === 0 ? [0.165, 0.471, 0.839, 1] : [0.922, 0.408, 0.204, 1]; });
}

const lighten = (c) => c.slice(0, 3).map((v) => v + (1 - v) * 0.35);

// Colours for the clusters shown right now: hues run along the tree order within each field's band (related clusters
// stay close in hue) while lightness cycles through four steps, so neighbours at any depth remain easy to tell apart.
const BANDS = { 0: [180, 290], 1: [-15, 65] };
const LIGHTNESS = [0.42, 0.64, 0.53, 0.74];
function zoomPalette(shown) {
  const colors = new Map();
  for (const corpus of [0, 1]) {
    const list = shown.filter((i) => nodes[i].corpus === corpus).sort((a, b) => dfsRank[a] - dfsRank[b]);
    const [lo, hi] = BANDS[corpus];
    list.forEach((i, r) => {
      const hue = (((lo + (hi - lo) * (r + 0.5) / list.length) % 360) + 360) % 360;
      colors.set(i, [...hslToRgb(hue, 0.78, LIGHTNESS[r % 4]), 1]);
    });
  }
  return colors;
}

const ancestorAtDepth = (i, depth) => { let k = i; while (nodes[k].depth > depth) k = nodes[k].parent; return k; };
const pathOf = (i) => { const out = []; for (let k = i; k >= 0; k = nodes[k].parent) out.unshift(k); return out; };
const rgbCss = (c) => `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})`;

async function loadData() {
  const [base, hier] = await Promise.all([
    fetch('../map-data.json').then((r) => { if (!r.ok) throw new Error(`map-data.json: ${r.status}`); return r.json(); }),
    fetch('../hier-data.json').then((r) => { if (!r.ok) throw new Error(`hier-data.json: ${r.status}`); return r.json(); }),
  ]);
  nodes = hier.nodes;
  children = nodes.map(() => []);
  nodes.forEach((n, i) => { if (n.parent >= 0) children[n.parent].push(i); });
  dfs = [];
  const visit = (i) => { dfs.push(i); children[i].forEach(visit); };
  nodes.forEach((n, i) => { if (n.parent < 0) visit(i); });
  dfsRank = new Array(nodes.length);
  dfs.forEach((i, r) => { dfsRank[i] = r; });
  assignColors();
  lowerTitles = base.title.map((t) => t.toLowerCase());
  return {
    title: base.title, arxiv: base.arxiv, year: base.year, corpus: base.corpus,
    leaf: hier.node, x: DIM3 ? hier.x3 : hier.x2, y: DIM3 ? hier.y3 : hier.y2, z: DIM3 ? hier.z3 : null,
  };
}

const isHidden = (id) => data.x[id] === null;

async function createNetwork() {
  const n = data.title.length;
  const network = await HeliosNetwork.create({ directed: false, initialNodes: 0 });
  const ids = network.addNodes(n);
  network.addEdges([{ from: ids[0], to: ids[1] }]); // Helios needs one edge; it is never drawn (opacity 0)
  network.nodeAttribute(LABEL, (_v, id) => data.title[id], { type: AttributeType.String });
  network.nodeAttribute(CORPUS, (_v, id) => data.corpus[id], { type: AttributeType.Int });
  network.nodeAttribute(COLOR_ID, (_v, id) => data.leaf[id], { type: AttributeType.Int });
  network.defineNodeAttribute(POSITION, AttributeType.Float, 3);
  network.withBufferAccess(() => {
    const pos = network.getNodeAttributeBuffer(POSITION)?.view;
    for (let i = 0; i < n; i += 1) {
      pos[i * 3] = data.x[i] ?? 0;
      pos[i * 3 + 1] = data.y[i] ?? 0;
      pos[i * 3 + 2] = data.z ? data.z[i] ?? 0 : 0;
    }
  });
  network.bumpNodeAttributeVersion?.(POSITION);
  return network;
}

function matches(id) {
  if (isHidden(id) || !state.corpora.has(data.corpus[id])) return false;
  return !state.search || lowerTitles[id].includes(state.search);
}

// The node that stands for a paper at the current colour setting.
function colorNode(id) {
  const leaf = data.leaf[id];
  if (state.colorMode === 'field') return leaf;
  if (state.colorMode === 'auto') {
    // deepest ancestor that is currently shown as a label cluster, else the root
    for (const k of pathOf(leaf).reverse()) if (state.shownSet?.has(k)) return k;
    return pathOf(leaf)[0];
  }
  return ancestorAtDepth(leaf, Number(state.colorMode));
}

function applyColors(helios) {
  const { network } = helios;
  const field = state.colorMode === 'field';
  const auto = state.colorMode === 'auto';
  network.nodeAttribute(COLOR_ID, (_v, id) => {
    if (isHidden(id)) return HIDDEN;
    if (!matches(id)) return DIM;
    return colorNode(id);
  }, { type: AttributeType.Int });
  network.bumpNodeAttributeVersion?.(COLOR_ID);
  const nodeIds = nodes.map((_n, i) => i);
  const colors = nodes.map((n, i) => (field ? nodes[pathOf(i)[0]].color : auto ? (state.zoomColors?.get(i) ?? n.color) : n.color));
  helios.nodeMapper.channel('color').from(COLOR_ID).categorical([...nodeIds, DIM, HIDDEN], [...colors, DIM_COLOR, HIDDEN_COLOR]).done();
  const base = state.nodeSize * (state.search ? 2.4 : 1);
  helios.nodeMapper.channel('size').from(COLOR_ID)
    .categorical([...nodeIds, DIM, HIDDEN], [...nodeIds.map(() => base), state.nodeSize * (state.search ? 0.6 : 1), 0]).done();
  helios.markMappersDirty?.();
  helios.requestRender();
}

// ---------- labels and semantic zoom ----------

const labelLayer = el('div', { className: 'tree-labels' });
const labelEls = [];

function project(vp, x, y, z, width, height) {
  const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  return { x: (cx / w * 0.5 + 0.5) * width, y: (1 - (cy / w * 0.5 + 0.5)) * height, w };
}

// Screen position of a point and the number of pixels one map unit spans there.
function screenScale(vp, c, width, height) {
  const p = project(vp, c[0], c[1], c[2] ?? 0, width, height);
  let best = 0;
  const axes = DIM3 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
  for (const [a, b, d] of axes) {
    const q = project(vp, c[0] + a, c[1] + b, (c[2] ?? 0) + d, width, height);
    best = Math.max(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return { p, scale: best };
}

// A label wears the colour of the cluster that paints its papers in the current colour mode.
function labelRgb(i) {
  const n = nodes[i];
  if (state.colorMode === 'auto') return state.zoomColors?.get(i) ?? n.color;
  if (state.colorMode === 'field') return nodes[pathOf(i)[0]].color;
  return nodes[ancestorAtDepth(i, Math.min(Number(state.colorMode), n.depth))].color;
}

function paintLabels() {
  nodes.forEach((_n, i) => { labelEls[i].style.color = rgbCss(lighten(labelRgb(i))); });
}

function layoutLabels(helios) {
  const camera = helios.renderer?.camera;
  if (!camera) return;
  const vp = camera.getUniforms().viewProjection;
  const { clientWidth: width, clientHeight: height } = viewer;
  const info = nodes.map((n) => screenScale(vp, DIM3 ? n.c3 : n.c2, width, height));
  const ref = state.refScale ?? Math.min(...info.map((q) => q.scale));
  const expanded = nodes.map((n, i) => children[i].length > 0 && (n.depth === 0 || info[i].scale / ref >= OPEN_AT[n.depth + 1]));
  const shown = [];
  nodes.forEach((n, i) => {
    const parentOpen = n.parent < 0 || expanded[n.parent];
    if (parentOpen && !expanded[i] && state.corpora.has(n.corpus)) shown.push(i);
  });
  // Places the biggest clusters first and drops a label that would overlap one already placed.
  const placed = [];
  const visible = new Set();
  state.boxes = new Map();
  for (const i of shown.sort((a, b) => nodes[b].n - nodes[a].n)) {
    const { p } = info[i];
    if (p.w <= 0 || p.x < -40 || p.y < -20 || p.x > width + 40 || p.y > height + 20) continue;
    const textWidth = nodes[i].name.length * 7 + 16;
    const box = [p.x - textWidth / 2, p.y - 11, p.x + textWidth / 2, p.y + 11];
    if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
    placed.push(box);
    state.boxes.set(i, box);
    visible.add(i);
    const label = labelEls[i];
    label.hidden = false;
    label.style.transform = `translate(${Math.round(box[0])}px, ${Math.round(box[1])}px)`;
  }
  nodes.forEach((_n, i) => { if (!visible.has(i)) labelEls[i].hidden = true; });
  const signature = shown.sort((a, b) => a - b).join(',');
  if (signature !== state.signature) {
    state.signature = signature;
    state.shownSet = new Set(shown);
    state.zoomColors = zoomPalette(shown);
    paintLabels();
    if (state.colorMode === 'auto') {
      clearTimeout(state.recolorTimer);
      state.recolorTimer = setTimeout(() => applyColors(helios), 160);
    }
  }
}

function mountLabels(helios) {
  viewer.append(labelLayer);
  nodes.forEach((n, i) => {
    const label = el('div', { className: 'tree-label', text: n.name, attrs: { title: `${n.n.toLocaleString()} papers` } });
    label.dataset.depth = String(n.depth);
    label.hidden = true;
    labelLayer.append(label);
    labelEls.push(label);
  });
  let queued = false;
  let trailing = null;
  const schedule = () => {
    // A trailing pass catches the pose the camera settles on after a transition.
    clearTimeout(trailing);
    trailing = setTimeout(() => layoutLabels(helios), 200);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; layoutLabels(helios); });
  };
  // Labels do not take the mouse (so wheel and drag always reach the map); a click is matched to a label by position.
  const labelAt = (event) => {
    const rect = viewer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const [i, box] of state.boxes ?? []) if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) return i;
    return null;
  };
  let downAt = null;
  viewer.addEventListener('pointerdown', (event) => { downAt = [event.clientX, event.clientY]; }, true);
  viewer.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 4) return;
    const i = labelAt(event);
    if (i !== null) { state.labelClickAt = Date.now(); selectNode(helios, i); }
  }, true);
  let hovered = null;
  viewer.addEventListener('pointermove', (event) => {
    const i = labelAt(event);
    if (i === hovered) return;
    if (hovered !== null) labelEls[hovered].classList.remove('is-hover');
    if (i !== null) labelEls[i].classList.add('is-hover');
    viewer.style.cursor = i !== null ? 'pointer' : '';
    hovered = i;
  });
  helios.on('render:after', schedule);
  helios.on('camera:move', schedule);
  window.addEventListener('resize', schedule);
  schedule();
}

// ---------- details ----------

const detail = el('aside', { className: 'detail is-empty' });

function nodeMembers(i) {
  const stack = [i];
  const set = new Set();
  while (stack.length) { const k = stack.pop(); set.add(k); stack.push(...children[k]); }
  const out = [];
  for (let id = 0; id < data.leaf.length; id += 1) if (data.leaf[id] >= 0 && set.has(data.leaf[id]) && !isHidden(id)) out.push(id);
  return out;
}

function frame(helios, ids, max = 800, openNode = null) {
  const step = Math.max(1, Math.floor(ids.length / max));
  helios.frameNetwork?.({ nodeIndices: ids.filter((_v, k) => k % step === 0), animate: true, durationMs: 600 });
  if (openNode === null || !children[openNode].length) return;
  // Framing a big cluster can leave the map too far out for it to open, so magnify until its children appear.
  setTimeout(() => {
    const n = nodes[openNode];
    const vp = helios.renderer.camera.getUniforms().viewProjection;
    const rel = screenScale(vp, DIM3 ? n.c3 : n.c2, viewer.clientWidth, viewer.clientHeight).scale / state.refScale;
    const need = OPEN_AT[n.depth + 1] * 1.15;
    if (rel >= need) return;
    const pose = helios.cameraPose();
    helios.transitionCamera(DIM3 ? { distance: pose.distance * rel / need } : { zoom: pose.zoom * need / rel }, { durationMs: 500 });
  }, 750);
}

function selectNode(helios, i) {
  const n = nodes[i];
  const path = pathOf(i).map((k) => nodes[k].name);
  const rows = [
    el('div', { className: 'detail__title', text: n.name }),
    el('div', { className: 'detail__path', text: `${CORPUS_NAMES[n.corpus]} · level ${n.depth} · ${n.n.toLocaleString()} papers` }),
    el('div', { className: 'detail__desc', text: n.desc }),
  ];
  if (path.length > 1) rows.push(el('div', { className: 'detail__section', children: [el('strong', { text: 'Within: ' }), el('span', { text: path.slice(0, -1).reverse().join(' ‹ ') })] }));
  if (n.corpus === 0 && n.moved) {
    rows.push(el('div', { className: 'detail__section', children: [el('strong', { text: 'Read after the shift onto multi-agent AI: ' }), el('span', { text: n.moved })] }));
    if (n.near.length) rows.push(el('div', { className: 'detail__section', children: [el('strong', { text: 'Nearest multi-agent clusters (level 4): ' }), el('span', { text: n.near.map((x) => `${nodes[x.node].name} (${x.cos.toFixed(2)})`).join('; ') })] }));
  }
  rows.push(el('div', { className: 'detail__section', text: 'Name and description are the Doc2LoRA decoder\'s reading of the cluster\'s mean embedding, not a human label.' }));
  const zoom = el('button', { text: 'Zoom to this cluster', attrs: { type: 'button' } });
  zoom.addEventListener('click', () => frame(helios, nodeMembers(i), 800, i));
  rows.push(el('div', { className: 'detail__links', children: [zoom] }));
  detail.classList.remove('is-empty');
  detail.replaceChildren(...rows);
  frame(helios, nodeMembers(i), 800, i);
}

function nearest(id, count) {
  const { x, y, z } = data;
  const d = new Float32Array(x.length);
  for (let k = 0; k < d.length; k += 1) {
    if (x[k] === null) { d[k] = Infinity; continue; }
    const dz = z ? z[k] - z[id] : 0;
    d[k] = (x[k] - x[id]) ** 2 + (y[k] - y[id]) ** 2 + dz * dz;
  }
  return Array.from(d.keys()).sort((a, b) => d[a] - d[b]).slice(0, count);
}

const describe = (id) => {
  const leaf = data.leaf[id];
  const rows = [['Field', CORPUS_NAMES[data.corpus[id]]], ['Cluster', nodes[leaf].name]];
  if (data.year[id]) rows.push(['Year', data.year[id]]);
  return rows;
};

function selectPaper(helios, id, focus = false) {
  helios.selectNodes?.([id]);
  const title = data.title[id];
  const links = [el('a', { text: 'Google Scholar', attrs: { href: `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`, target: '_blank', rel: 'noopener' } })];
  if (data.arxiv[id]) links.unshift(el('a', { text: `arXiv:${data.arxiv[id]}`, attrs: { href: `https://arxiv.org/abs/${data.arxiv[id]}`, target: '_blank', rel: 'noopener' } }));
  const path = pathOf(data.leaf[id]).map((k) => nodes[k].name).slice(1);
  detail.classList.remove('is-empty');
  detail.replaceChildren(
    el('div', { className: 'detail__title', text: title }),
    el('div', { className: 'detail__meta', text: `${CORPUS_NAMES[data.corpus[id]]}${data.year[id] ? `  ·  ${data.year[id]}` : ''}` }),
    el('div', { className: 'detail__path', text: path.join(' › ') }),
    el('div', { className: 'detail__links', children: links }),
  );
  if (focus) helios.frameNetwork?.({ nodeIndices: nearest(id, 150), animate: true, durationMs: 500 });
}

// ---------- panels ----------

function topMatches(limit = 12) {
  const lists = [[], []];
  const per = Math.ceil(limit / 2);
  for (let id = 0; id < lowerTitles.length && (lists[0].length < per || lists[1].length < per); id += 1) {
    const list = lists[data.corpus[id]];
    if (list.length < per && matches(id)) list.push(id);
  }
  const merged = [];
  for (let i = 0; i < per; i += 1) for (const list of lists) if (list[i] != null) merged.push(list[i]);
  return merged.slice(0, limit);
}

function mountPanels(helios) {
  const ui = new HeliosUI({ helios, theme: 'dark', allowDrag: true, layerName: 'map-ui', persistenceIndicators: false });
  const browser = el('div', { className: 'analytics-panel' });
  const results = el('div', { className: 'results' });
  const resultHeading = el('div', { className: 'results__heading' });
  const renderResults = () => {
    results.replaceChildren();
    if (!state.search) { resultHeading.textContent = ''; return; }
    let total = 0;
    for (let id = 0; id < lowerTitles.length; id += 1) if (matches(id)) total += 1;
    resultHeading.textContent = `${total.toLocaleString()} match${total === 1 ? '' : 'es'}${total > 12 ? ', first 12 shown' : ''}`;
    for (const id of topMatches()) {
      const button = el('button', { className: 'result', attrs: { type: 'button' }, children: [
        el('span', { className: 'result__dot', attrs: { style: `background: ${rgbCss(nodes[pathOf(data.leaf[id])[0]].color)}` } }),
        el('span', { className: 'result__title', text: data.title[id] }),
      ] });
      button.addEventListener('click', () => selectPaper(helios, id, true));
      results.append(button);
    }
  };
  browser.append(createSearch({
    placeholder: 'Search titles',
    onInput: (query) => {
      state.search = query.trim().toLowerCase();
      applyColors(helios);
      renderResults();
      setStatus(state.search ? `Searching: ${query}` : '');
    },
  }).root);
  browser.append(resultHeading, results);
  browser.append(createChecklist({
    label: 'Show',
    options: CORPUS_NAMES.map((label, value) => ({ value, label })),
    selected: state.corpora,
    onChange: (selected) => { state.corpora = selected; state.signature = null; applyColors(helios); renderResults(); layoutLabels(helios); },
  }).root);
  ui.createPanel({ id: 'map-browser', title: 'Search', content: browser, dock: 'top-left', position: { x: 16, y: 16 }, width: 340, minWidth: 340 });

  const view = el('div', { className: 'analytics-panel' });
  view.append(createSegmented({
    label: 'Dimensions',
    value: DIM3 ? '3' : '2',
    options: [{ value: '2', label: '2D' }, { value: '3', label: '3D' }],
    onChange: (value) => { if ((value === '3') !== DIM3) location.search = value === '3' ? '?dim=3' : ''; },
  }).root);
  view.append(el('div', { className: 'layer-note', text: 'Zoom in and a cluster opens into its two sub-clusters (up to seven levels per field). Click a label for its description. Management papers are shifted onto multi-agent AI by one translation before the map is drawn. 70,576 papers (60 multi-agent papers without an abstract are left out).' }));
  view.append(createSegmented({
    label: 'Color',
    value: state.colorMode,
    options: [{ value: 'auto', label: 'Zoom' }, { value: 'field', label: 'Field' }, { value: '1', label: 'L1' }, { value: '2', label: 'L2' }, { value: '3', label: 'L3' }, { value: '4', label: 'L4' }],
    onChange: (value) => { state.colorMode = value; applyColors(helios); paintLabels(); },
  }).root);
  view.append(createSlider({ label: 'Node size', value: state.nodeSize, min: DIM3 ? 0.05 : 0.5, max: DIM3 ? 2 : 6, step: DIM3 ? 0.05 : 0.1, onInput: (v) => { state.nodeSize = v; applyColors(helios); } }).root);
  view.append(createSlider({ label: 'Opacity', value: state.nodeOpacity, min: 0.1, max: 1, step: 0.01, onInput: (v) => { state.nodeOpacity = v; helios.nodeOpacityScale(v); helios.requestRender(); } }).root);
  const fit = el('button', { className: 'segmented__button', text: 'Fit all', attrs: { type: 'button' } });
  fit.addEventListener('click', () => helios.requestFrameNetwork({ paddingPx: 80 }));
  view.append(fit);
  view.append(el('div', { className: 'layer-note', children: [el('a', { text: 'Poster map', attrs: { href: '../', style: 'color:#eb6834' } })] }));
  ui.createPanel({ id: 'map-view', title: 'View', content: view, dock: 'top-right', position: { x: 16, y: 16 }, width: 300, minWidth: 300 });
}

function mountHover(helios) {
  const hover = createHoverCard(viewer);
  viewer.append(detail);
  helios.resetStateStyles().nodeStateStyle('HIGHLIGHTED', { sizeMul: 2.2, opacityMul: 1, outlineMul: 1.8, colorAdd: [0.12, 0.12, 0.12, 0] });
  helios.enableNodePicking({ resolutionScale: 0.5, trackDepth: false, maxFps: 24 });
  helios.on('node:hover', (event) => {
    const d = event?.detail;
    if (d?.state === 'in' && d.index >= 0) {
      helios.hoverNodeState(d.index, 'HIGHLIGHTED');
      hover.setNode(data.title[d.index], describe(d.index));
      return;
    }
    helios.hoverNodeState(null, 0);
    hover.setEmpty();
  });
  helios.on('node:click', (event) => {
    const index = event?.detail?.index;
    if (index >= 0 && Date.now() - (state.labelClickAt ?? 0) > 1200) selectPaper(helios, index);
  });
}

async function bootstrap() {
  setStatus('Loading papers');
  data = await loadData();
  setStatus('Building the map');
  const network = await createNetwork();
  const helios = new Helios(network, {
    container: viewer,
    ui: false,
    quickControls: true,
    storage: false,
    session: false,
    warnOnUnsavedChanges: false,
    mode: DIM3 ? '3d' : '2d',
    projection: DIM3 ? 'perspective' : 'orthographic',
    layout: { type: 'static' },
  });
  await helios.ready;
  if (helios.renderer?.camera) helios.renderer.camera.maxZoom = 400; // the default (30) stops short of the deepest levels
  helios.stopLayout?.('map-static');
  helios.behavior?.layout?.applyPositionAttribute?.(POSITION, { reason: 'initial-position' });
  helios.edgeOpacityBase(0).edgeOpacityScale(0);
  helios.nodeOutlineWidthBase(0).nodeOutlineWidthScale(0).semanticZoomExponent(0.6).clearColor('#0b0b0b');
  state.shownSet = new Set();
  applyColors(helios);
  helios.labels({ enabled: false });
  helios.legends?.({ enabled: false });
  mountPanels(helios);
  mountHover(helios);
  mountLabels(helios);
  helios.requestFrameNetwork({ paddingPx: 80 });
  requestAnimationFrame(() => requestAnimationFrame(() => { helios.requestFrameNetwork({ paddingPx: 80 }); helios.requestRender(); }));
  // Magnification is measured against the framed whole map.
  setTimeout(() => {
    const vp = helios.renderer.camera.getUniforms().viewProjection;
    state.refScale = screenScale(vp, [0, 0, 0], viewer.clientWidth, viewer.clientHeight).scale;
    state.signature = null;
    layoutLabels(helios);
  }, 1500);
  window.helios = helios;
  window.hier = { state, nodes, layoutLabels: () => layoutLabels(helios) };
  setStatus('');
}

bootstrap().catch((error) => {
  console.error(error);
  setStatus('Failed to load');
  viewer.insertAdjacentHTML('beforeend', '<pre style="color:#fff;padding:1rem;white-space:pre-wrap"></pre>');
  viewer.querySelector('pre').textContent = String(error?.stack ?? error);
});
