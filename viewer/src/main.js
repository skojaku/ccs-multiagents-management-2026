import HeliosNetwork, { AttributeType } from 'helios-network';
import { Helios, HeliosUI } from 'helios-web';

import { createChecklist, createHoverCard, createSearch, createSegmented, createSlider, el } from './ui-controls.js';
import { styleNodes } from './node-style.js';
import './styles.css';

const viewer = document.querySelector('#viewer');

const LABEL = 'Label';
const CORPUS = 'CorpusId'; // 0 management, 1 multi-agent AI
const REGION = 'RegionId'; // 0-5 management regions, 6-11 multi-agent regions
const YEAR = 'Year';
const COLOR_ID = 'ColorId'; // category used for color; DIM when a paper is filtered out
const DIM = 100;
const HIDDEN = 101; // papers without coordinates in the current layer
const POSITION = '_helios_visuals_position';

// The poster's palette: blue = management, orange = multi-agent AI.
const CORPUS_NAMES = ['Management', 'Multi-agent AI'];
const CORPUS_COLORS = [[0.165, 0.471, 0.839, 1], [0.922, 0.408, 0.204, 1]];
const REGION_COLORS = [
  [0.165, 0.471, 0.839, 1], [0.47, 0.67, 0.93, 1], [0.1, 0.3, 0.6, 1],
  [0.4, 0.75, 0.85, 1], [0.6, 0.55, 0.9, 1], [0.35, 0.55, 0.45, 1],
  [0.922, 0.408, 0.204, 1], [0.98, 0.62, 0.3, 1], [0.7, 0.25, 0.15, 1],
  [0.95, 0.8, 0.3, 1], [0.85, 0.35, 0.5, 1], [0.6, 0.45, 0.25, 1],
];

let data = null;
let lowerTitles = [];

const state = {
  search: '',
  corpora: new Set([0, 1]),
  colorMode: 'corpus',
  nodeOpacity: 0.85,
  nodeSize: 1.6,
  layer: 'poster',
};

const LAYERS = [
  { value: 'poster', label: 'Poster', note: 'The poster map. Multi-agent papers are embedded from their PDF text, management papers from title and abstract.' },
  { value: 'abstract', label: 'Abstract', note: 'Both fields embedded from title and abstract, no alignment. The 60 multi-agent papers without a usable abstract are not shown. Multi-agent regions are inherited from the poster; management regions are re-clustered and named by decoding.' },
  { value: 'translate', label: 'Abstract, shifted', note: 'Same embeddings as Abstract, with each field shifted to a common mean (translation and rescaling), t-SNE recomputed. The fields still occupy mostly separate regions.' },
];

const layer = () => data.layers[state.layer];
const isHidden = (id) => layer().x[id] === null;

function setStatus(message) {
  viewer.dataset.status = message ?? '';
}

async function loadData() {
  const response = await fetch('./map-data.json');
  if (!response.ok) throw new Error(`Failed to fetch map-data.json: ${response.status}`);
  const payload = await response.json();
  lowerTitles = payload.title.map((title) => title.toLowerCase());
  return payload;
}

async function createNetwork() {
  const n = data.title.length;
  const network = await HeliosNetwork.create({ directed: false, initialNodes: 0 });
  const nodes = network.addNodes(n);
  // Helios expects at least one edge for its edge buffers; this one is never drawn (edge opacity 0).
  network.addEdges([{ from: nodes[0], to: nodes[1] }]);
  network.nodeAttribute(LABEL, (_value, id) => data.title[id], { type: AttributeType.String });
  network.nodeAttribute(CORPUS, (_value, id) => data.corpus[id], { type: AttributeType.Int });
  network.nodeAttribute(YEAR, (_value, id) => data.year[id], { type: AttributeType.Int });
  network.nodeAttribute(COLOR_ID, (_value, id) => data.corpus[id], { type: AttributeType.Int });
  network.defineNodeAttribute(POSITION, AttributeType.Float, 3);
  network.withBufferAccess(() => {
    const positions = network.getNodeAttributeBuffer(POSITION)?.view;
    for (let index = 0; index < n; index += 1) {
      positions[index * 3] = data.layers.poster.x[index];
      positions[index * 3 + 1] = data.layers.poster.y[index];
      positions[index * 3 + 2] = 0;
    }
  });
  network.bumpNodeAttributeVersion?.(POSITION);
  return network;
}

function matches(id) {
  if (isHidden(id)) return false;
  if (!state.corpora.has(data.corpus[id])) return false;
  return !state.search || lowerTitles[id].includes(state.search);
}

const DIM_COLOR = [0.25, 0.25, 0.25, 0.22];
const HIDDEN_COLOR = [0, 0, 0, 0];

function applyColorMode(helios) {
  const ids = state.colorMode === 'region' ? [...REGION_COLORS.keys(), DIM, HIDDEN] : [0, 1, DIM, HIDDEN];
  const colors = state.colorMode === 'region' ? [...REGION_COLORS, DIM_COLOR, HIDDEN_COLOR] : [...CORPUS_COLORS, DIM_COLOR, HIDDEN_COLOR];
  helios.nodeMapper.channel('color').from(COLOR_ID).categorical(ids, colors).done();
}

function applyVisibility(helios) {
  const { network } = helios;
  const byRegion = state.colorMode === 'region';
  network.nodeAttribute(COLOR_ID, (_value, id) => {
    if (isHidden(id)) return HIDDEN;
    if (!matches(id)) return DIM;
    return byRegion ? layer().region[id] : data.corpus[id];
  }, { type: AttributeType.Int });
  network.bumpNodeAttributeVersion?.(COLOR_ID);
  const base = state.nodeSize;
  const sizeIds = [...REGION_COLORS.keys(), DIM, HIDDEN];
  const sizes = [...REGION_COLORS.keys()].map(() => base * (state.search ? 3.6 : 1)).concat([base * (state.search ? 0.35 : 1), 0]);
  helios.nodeMapper.channel('size').from(COLOR_ID).categorical(sizeIds, sizes).done();
  helios.markMappersDirty?.();
  helios.requestRender();
}

function topMatches(limit = 12) {
  // Alternate between the two fields so that one field's rows do not crowd out the other's.
  const lists = [[], []];
  const per = Math.ceil(limit / 2);
  for (let id = 0; id < lowerTitles.length && (lists[0].length < per || lists[1].length < per); id += 1) {
    const list = lists[data.corpus[id]];
    if (list.length < per && matches(id)) list.push(id);
  }
  const merged = [];
  for (let i = 0; i < per; i += 1) for (const list of [lists[0], lists[1]]) if (list[i] != null) merged.push(list[i]);
  return merged.slice(0, limit);
}

function nearest(id, count) {
  const { x, y } = layer();
  const dist = new Float32Array(x.length);
  for (let i = 0; i < dist.length; i += 1) {
    const dx = x[i] - x[id];
    const dy = y[i] - y[id];
    dist[i] = x[i] === null ? Infinity : dx * dx + dy * dy;
  }
  return Array.from(dist.keys()).sort((a, b) => dist[a] - dist[b]).slice(0, count);
}

function scholarUrl(title) {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
}

function describe(id) {
  const rows = [
    ['Field', CORPUS_NAMES[data.corpus[id]]],
    ['Region', layer().regionNames[layer().region[id]]],
  ];
  if (data.year[id]) rows.push(['Year', data.year[id]]);
  return rows;
}

function mountPanels(helios) {
  const ui = new HeliosUI({ helios, theme: 'dark', allowDrag: true, layerName: 'map-ui', persistenceIndicators: false });
  const statValues = [el('strong'), el('strong')];
  const updateCounts = () => {
    const counts = [0, 0];
    data.corpus.forEach((c, id) => { if (!isHidden(id)) counts[c] += 1; });
    statValues[0].textContent = counts[0].toLocaleString();
    statValues[1].textContent = counts[1].toLocaleString();
  };
  updateCounts();

  const browser = el('div', { className: 'analytics-panel' });
  browser.append(el('div', {
    className: 'stats',
    children: [
      el('div', { className: 'stat', children: [el('span', { text: 'Management' }), statValues[0]] }),
      el('div', { className: 'stat', children: [el('span', { text: 'Multi-agent AI' }), statValues[1]] }),
    ],
  }));

  const results = el('div', { className: 'results' });
  const resultHeading = el('div', { className: 'results__heading' });
  const renderResults = () => {
    results.replaceChildren();
    if (!state.search) {
      resultHeading.textContent = '';
      return;
    }
    const total = (() => { let t = 0; for (let id = 0; id < lowerTitles.length; id += 1) if (matches(id)) t += 1; return t; })();
    resultHeading.textContent = `${total.toLocaleString()} match${total === 1 ? '' : 'es'}${total > 12 ? ', first 12 shown' : ''}`;
    for (const id of topMatches()) {
      const button = el('button', { className: 'result', attrs: { type: 'button' }, children: [
        el('span', { className: 'result__dot', attrs: { style: `background: rgb(${CORPUS_COLORS[data.corpus[id]].slice(0, 3).map((v) => Math.round(v * 255)).join(',')})` } }),
        el('span', { className: 'result__title', text: data.title[id] }),
      ] });
      button.addEventListener('click', () => select(helios, id, true));
      results.append(button);
    }
  };

  browser.append(createSearch({
    placeholder: 'Search titles',
    onInput: (query) => {
      state.search = query.trim().toLowerCase();
      applyVisibility(helios);
      renderResults();
      setStatus(state.search ? `Searching: ${query}` : 'Ready');
    },
  }).root);
  browser.append(resultHeading, results);
  browser.append(createChecklist({
    label: 'Show',
    options: CORPUS_NAMES.map((label, value) => ({ value, label })),
    selected: state.corpora,
    onChange: (selected) => {
      state.corpora = selected;
      applyVisibility(helios);
      renderResults();
    },
  }).root);
  ui.createPanel({ id: 'map-browser', title: 'Search', content: browser, dock: 'top-left', position: { x: 16, y: 16 }, width: 340, minWidth: 340 });

  const view = el('div', { className: 'analytics-panel' });
  const layerNote = el('div', { className: 'layer-note', text: LAYERS[0].note });
  const setLayer = (value) => {
    state.layer = value;
    const L = layer();
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (let i = 0; i < L.x.length; i += 1) if (L.x[i] !== null) { cx += L.x[i]; cy += L.y[i]; n += 1; }
    cx /= n;
    cy /= n;
    helios.network.withBufferAccess(() => {
      const pos = helios.network.getNodeAttributeBuffer(POSITION)?.view;
      for (let i = 0; i < L.x.length; i += 1) {
        pos[i * 3] = L.x[i] ?? cx; // papers without coordinates are hidden, parked at the centre
        pos[i * 3 + 1] = L.y[i] ?? cy;
      }
    });
    helios.network.bumpNodeAttributeVersion?.(POSITION);
    helios.behavior?.layout?.applyPositionAttribute?.(POSITION, { reason: 'layer-change' });
    applyColorMode(helios);
    applyVisibility(helios);
    renderLegend();
    renderResults();
    updateCounts();
    layerNote.textContent = LAYERS.find((l) => l.value === value).note;
    helios.requestFrameNetwork({ paddingPx: 80 });
    requestAnimationFrame(() => requestAnimationFrame(() => { helios.requestFrameNetwork({ paddingPx: 80 }); helios.requestRender(); }));
  };
  view.append(createSegmented({
    label: 'Map',
    value: state.layer,
    options: LAYERS.map(({ value, label }) => ({ value, label })),
    onChange: setLayer,
  }).root);
  view.append(layerNote);
  view.append(createSegmented({
    label: 'Color',
    value: state.colorMode,
    options: [{ value: 'corpus', label: 'Field' }, { value: 'region', label: 'Region' }],
    onChange: (value) => { state.colorMode = value; applyColorMode(helios); applyVisibility(helios); renderLegend(); },
  }).root);
  const legend = el('div', { className: 'legend' });
  const renderLegend = () => {
    const entries = state.colorMode === 'region'
      ? layer().regionNames.map((name, i) => [name, REGION_COLORS[i]])
      : CORPUS_NAMES.map((name, i) => [name, CORPUS_COLORS[i]]);
    legend.replaceChildren(...entries.map(([name, c]) => el('div', { className: 'legend__row', children: [
      el('span', { className: 'result__dot', attrs: { style: `background: rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})` } }),
      el('span', { text: name }),
    ] })));
  };
  renderLegend();
  view.append(legend);
  view.append(el('div', { className: 'layer-note', children: [
    el('span', { text: 'Hierarchical map (zoom opens sub-clusters): ' }),
    el('a', { text: '2D', attrs: { href: './hierarchy/', style: 'color:#eb6834' } }),
    el('span', { text: ' · ' }),
    el('a', { text: '3D', attrs: { href: './hierarchy/?dim=3', style: 'color:#eb6834' } }),
  ] }));
  view.append(createSlider({ label: 'Node size', value: state.nodeSize, min: 0.5, max: 5, step: 0.1, onInput: (v) => { state.nodeSize = v; applyVisibility(helios); } }).root);
  view.append(createSlider({ label: 'Opacity', value: state.nodeOpacity, min: 0.1, max: 1, step: 0.01, onInput: (v) => { state.nodeOpacity = v; helios.nodeOpacityScale(v); helios.requestRender(); } }).root);
  ui.createPanel({ id: 'map-view', title: 'View', content: view, dock: 'top-right', position: { x: 16, y: 16 }, width: 300, minWidth: 300 });
}

const detail = el('aside', { className: 'detail is-empty' });

function select(helios, id, focus = false) {
  helios.selectNodes?.([id]);
  const title = data.title[id];
  const links = [el('a', { text: 'Google Scholar', attrs: { href: scholarUrl(title), target: '_blank', rel: 'noopener' } })];
  if (data.arxiv[id]) links.unshift(el('a', { text: `arXiv:${data.arxiv[id]}`, attrs: { href: `https://arxiv.org/abs/${data.arxiv[id]}`, target: '_blank', rel: 'noopener' } }));
  detail.classList.remove('is-empty');
  const close = el('button', { className: 'detail__close', text: '×', attrs: { type: 'button', 'aria-label': 'Close' } });
  close.addEventListener('click', () => { detail.classList.add('is-empty'); detail.replaceChildren(); helios.selectNodes?.([]); helios.requestRender(); });
  detail.replaceChildren(
    close,
    el('div', { className: 'detail__title', text: title }),
    el('div', { className: 'detail__meta', text: describe(id).map(([k, v]) => `${k}: ${v}`).join('  ·  ') }),
    el('div', { className: 'detail__links', children: links }),
  );
  if (focus) {
    // Frame the paper together with its 150 nearest neighbours so the view keeps some context.
    const near = nearest(id, 150);
    helios.frameNetwork?.({ nodeIndices: near, animate: true, durationMs: 500 });
  }
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
    if (index >= 0) select(helios, index);
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
    // Fixed t-SNE coordinates: static 2D is an intentional override of the Helios defaults.
    mode: '2d',
    projection: 'orthographic',
    layout: { type: 'static' },
  });
  await helios.ready;
  helios.stopLayout?.('map-static');
  helios.behavior?.layout?.applyPositionAttribute?.(POSITION, { reason: 'initial-position' });
  helios.edgeOpacityBase(0).edgeOpacityScale(0);
  helios.semanticZoomExponent(0.6).clearColor('#0b0b0b');
  styleNodes(helios);
  applyColorMode(helios);
  applyVisibility(helios);
  helios.labels({ enabled: false });
  helios.legends?.({ enabled: false });
  mountPanels(helios);
  mountHover(helios);
  helios.requestFrameNetwork({ paddingPx: 80 });
  requestAnimationFrame(() => requestAnimationFrame(() => { helios.requestFrameNetwork({ paddingPx: 80 }); helios.requestRender(); }));
  window.helios = helios;
  setStatus('');
}

bootstrap().catch((error) => {
  console.error(error);
  setStatus('Failed to load');
  viewer.insertAdjacentHTML('beforeend', '<pre style="color:#fff;padding:1rem;white-space:pre-wrap"></pre>');
  viewer.querySelector('pre').textContent = String(error?.stack ?? error);
});
