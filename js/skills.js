// ===== skills.js =====

const VERSION = '3';

// DOM
const elTree   = document.getElementById('tree');
const elClass  = document.getElementById('classSelect');
const elLevel  = document.getElementById('levelInput');
const elSpent  = document.getElementById('spent');
const elTotal  = document.getElementById('total');
const btnReset = document.getElementById('resetBtn');
const btnShare = document.getElementById('shareBtn');

// State
let defs = {};
let data = {};
let GRID = { cols: 9, rows: 6, start: { x: 4, y: 0 } };
let TREE = null;                // current class tree (from data.classes[...])
let currentClass = 'reaver';
let level = 20;                 // 1..100
let alloc = {};                 // { nodeId: rank }

// ---- Tooltip (single instance, positioned via left/top for accuracy) ----
let tipEl = null, tipStatic = null, tipDyn = null;
let tipRaf = 0, tipPendingX = 0, tipPendingY = 0;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'mc-tooltip';
  tipStatic = document.createElement('div');
  tipDyn = document.createElement('div'); tipDyn.className = 'dyn';
  tipEl.appendChild(tipStatic);
  tipEl.appendChild(tipDyn);
  document.body.appendChild(tipEl);
  return tipEl;
}
function placeTipNow(x, y) {
  const pad = 12;
  const rect = tipEl.getBoundingClientRect();
  let nx = x + pad;
  let ny = y + pad;
  const maxX = window.innerWidth  - rect.width  - pad;
  const maxY = window.innerHeight - rect.height - pad;
  tipEl.style.left = Math.max(pad, Math.min(nx, maxX)) + 'px';
  tipEl.style.top  = Math.max(pad, Math.min(ny, maxY)) + 'px';
}
function moveTip(x, y) {
  tipPendingX = x; tipPendingY = y;
  if (tipRaf) return;
  tipRaf = requestAnimationFrame(() => {
    placeTipNow(tipPendingX, tipPendingY);
    tipRaf = 0;
  });
}
function showTipFor(node, cur, max, clientX, clientY) {
  ensureTip();
  const def = node.def ? defs[node.def] : null;
  const name = def?.name || node.id;
  const descHtml = def?.desc ? escapeHtml(def.desc).replace(/\r?\n/g, '<br/>') : '';

  tipStatic.innerHTML =
    `<div class="title">${escapeHtml(name)} ${cur}/${max}</div>` +
    (descHtml ? `<div class="meta">${descHtml}</div>` : '');

  if (def && !def.noValue) {
    const curV  = valueAt(def, cur);
    const nextV = cur < max ? valueAt(def, cur + 1) : null;
    tipDyn.innerHTML =
      `<span class="meta">Current:</span> <span class="good">${fmt(curV.total, curV.suffix)}${curV.suffix}</span><br/>
       <span class="meta">Next Level:</span> ${nextV ? `<span class="warn">${fmt(nextV.total, nextV.suffix)}${nextV.suffix}</span>` : '—'}`;
  } else {
    tipDyn.innerHTML = '';
  }

  tipEl.style.display = 'block';
  placeTipNow(clientX, clientY);
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ---- boot
init().catch(err => console.error(err));

async function init() {
  // load definitions + trees
const [defsRes, treesRes] = await Promise.all([
  fetch(`data/skills/defs.json?v=${VERSION}`,  { cache: 'no-store' }),
  fetch(`data/skills/trees.json?v=${VERSION}`, { cache: 'no-store' })
]);


  defs = await defsRes.json();
  data = await treesRes.json();
  GRID = data.grid || GRID;

  // pick class
  if (elClass && elClass.value) currentClass = elClass.value;
  TREE = data.classes[currentClass];

  // restore from URL or localStorage
  if (!loadFromUrl()) loadSaved();

  // clamp/sanitize
  level = clamp(level, 1, 100);
  TREE = data.classes[currentClass] || Object.values(data.classes)[0];
  if (!TREE) throw new Error('No class trees found.');
  pruneOrphans(TREE, defs, alloc);
  clampToBudget();

  // wire events
  attachEvents();

  // initial UI
  updatePointsUI();
  renderBoard();
}

function attachEvents() {
  // Kill native context menu on the board (incl. Shift+RMB)
  elTree.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); }, { capture: true });
  elTree.addEventListener('pointerdown', e => { if (e.button === 2) { e.preventDefault(); e.stopPropagation(); } }, { capture: true });

  elClass.addEventListener('change', () => {
    currentClass = elClass.value;
    TREE = data.classes[currentClass];
    alloc = {};
    save(); updatePointsUI(); renderBoard();
  });

  elLevel.addEventListener('input', () => {
    level = clamp(parseInt(elLevel.value || '1', 10), 1, 100);
    clampToBudget();
    save(); updatePointsUI(); renderBoard();
  });

  btnReset.addEventListener('click', () => {
    alloc = {};
    save(); updatePointsUI(); renderBoard();
  });

  btnShare.addEventListener('click', async () => {
    const url = makeShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      btnShare.textContent = 'Link copied!';
      setTimeout(() => (btnShare.textContent = 'Copy Share Link'), 1200);
    } catch {
      prompt('Copy this link:', url);
    }
  });
}

// ---- layout/render

function renderBoard() {
  elTree.className = 'mc-board';
  elTree.innerHTML = '';

  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      const slot = document.createElement('div');
      slot.className = 'mc-slot';
      slot.dataset.x = x;
      slot.dataset.y = y;

      const node = nodeAt(TREE, x, y);
      if (node) {
        const cur = alloc[node.id] || 0;
        const max = capOf(node, defs);
        const canSpend = isAllocatable(TREE, defs, alloc, node);

        // state classes
        if (cur === 0) {
          slot.classList.add(canSpend ? 'state-available' : 'state-empty');
        } else if (cur < max) {
          slot.classList.add('state-progress');
        } else {
          slot.classList.add('state-max');
        }
        // visual dim for truly locked nodes
        slot.classList.toggle('locked', cur === 0 && !canSpend);

        // --- Visuals: either an icon (exclusive) or a colored pane ---
        const defIcon = (node.def && defs[node.def] && defs[node.def].icon) ? defs[node.def].icon : null;
        const chosenIcon = node.icon || defIcon || (node.type === 'start' ? 'mc/items/end_crystal.png' : null);

        if (chosenIcon) {
          // Icon node (no pane underneath)
          const img = document.createElement('img');
          img.className = 'item';
          img.alt = '';
          const iconPath =
            /^https?:\/\//.test(chosenIcon) || /^(\.\/|\.\.\/|\/)/.test(chosenIcon)
              ? chosenIcon
              : `images/assets/${chosenIcon}`;
          img.src = iconPath;
          img.addEventListener('error', () => { img.style.display = 'none'; console.warn('[icon load failed]', node.id, iconPath); });
          slot.appendChild(img);
          // icon nodes shouldn't appear dimmed
          slot.classList.remove('locked');
        } else {
          // Pane-only node (state color via CSS class)
          slot.appendChild(Object.assign(document.createElement('div'), { className: 'pane' }));
        }

        // --- Interactions ---
        // Left click (+1) or Shift+Click (fill up to cap/budget)
        slot.addEventListener('click', (e) => {
          if (e.shiftKey) {
            if (addMaxPoints(TREE, defs, alloc, level, node)) {
              save(); updatePointsUI(); renderBoard();
            }
            return;
          }
          if (addPoint(TREE, defs, alloc, level, node)) {
            save(); updatePointsUI(); renderBoard();
          }
        });

        // Right click (-1)
        slot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (removePoint(TREE, defs, alloc, node)) {
            save(); updatePointsUI(); renderBoard();
          }
        });

        // Tooltip
        slot.addEventListener('pointerenter', e => showTipFor(node, cur, max, e.clientX, e.clientY), { passive: true });
        slot.addEventListener('pointermove',  e => moveTip(e.clientX, e.clientY),                    { passive: true });
        slot.addEventListener('pointerleave', hideTip,                                              { passive: true });
      }

      elTree.appendChild(slot);
    }
  }
}

function updatePointsUI() {
  elTotal.textContent = String(level);
  elSpent.textContent = String(spent(alloc));
}

// ---- rules/logic

const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

function nodeAt(tree, x, y) {
  return tree.nodes.find(n => n.x === x && n.y === y);
}
function neighbors4(tree, n) {
  return DIRS.map(([dx, dy]) => nodeAt(tree, n.x + dx, n.y + dy)).filter(Boolean);
}
function capOf(n, defs) {
  if (typeof n.max === 'number') return n.max;
  if (n.def && defs[n.def] && typeof defs[n.def].max === 'number') return defs[n.def].max;
  return 1;
}

// Allocatable if: start, already has points, or any neighbor is fully maxed
function isAllocatable(tree, defs, alloc, n) {
  if (n.type === 'start') return true;
  const cur = alloc[n.id] || 0;
  if (cur > 0) return true;
  return neighbors4(tree, n).some(adj => (alloc[adj.id] || 0) >= capOf(adj, defs));
}

// BFS of nodes reachable from start via pass-through (start or fully maxed)
function reachableSet(tree, defs, alloc) {
  const start = tree.nodes.find(n => n.type === 'start');
  if (!start) return new Set();

  const seen = new Set([start.id]);
  const q = [{ id: start.id, pass: true }];

  while (q.length) {
    const cur = q.shift();
    const node = tree.nodes.find(n => n.id === cur.id);
    const canPass = node.type === 'start' || (alloc[node.id] || 0) >= capOf(node, defs);

    for (const nb of neighbors4(tree, node)) {
      if (!cur.pass) continue;
      if (seen.has(nb.id)) continue;
      seen.add(nb.id);
      const nbPass = (alloc[nb.id] || 0) >= capOf(nb, defs);
      q.push({ id: nb.id, pass: nbPass });
    }
  }
  return seen;
}

// Trim any allocated node that is not reachable
function pruneOrphans(tree, defs, alloc) {
  const reach = reachableSet(tree, defs, alloc);
  for (const id of Object.keys(alloc)) {
    if (!reach.has(id)) delete alloc[id];
  }
}

// +1 with budget/cap checks
function addPoint(tree, defs, alloc, lvl, n) {
  const max = capOf(n, defs);
  const cur = alloc[n.id] || 0;
  if (!isAllocatable(tree, defs, alloc, n)) return false;
  if (cur >= max) return false;
  if (spent(alloc) >= lvl) return false;
  alloc[n.id] = cur + 1;
  return true;
}

// Fill this node up to min(cap-left, remaining budget)
function addMaxPoints(tree, defs, alloc, lvl, n) {
  const cap = capOf(n, defs);
  const cur = alloc[n.id] || 0;
  if (cur === 0 && !isAllocatable(tree, defs, alloc, n)) return false;

  const remainingBudget = Math.max(0, lvl - spent(alloc));
  const canAdd = Math.min(cap - cur, remainingBudget);
  if (canAdd <= 0) return false;

  alloc[n.id] = cur + canAdd;
  return true;
}

// -1 (and prune if it breaks connectivity)
function removePoint(tree, defs, alloc, n) {
  const cur = alloc[n.id] || 0;
  if (cur <= 0) return false;
  alloc[n.id] = cur - 1;
  if (alloc[n.id] === 0) delete alloc[n.id];
  pruneOrphans(tree, defs, alloc);
  return true;
}

function spent(a) { return Object.values(a).reduce((s, v) => s + v, 0); }

// If overspent due to lowering level, trim arbitrary nodes (non-start) until within budget
function clampToBudget() {
  while (spent(alloc) > level) {
    const id = Object.keys(alloc).find(k => k !== 'start' && alloc[k] > 0);
    if (!id) break;
    alloc[id] -= 1;
    if (alloc[id] === 0) delete alloc[id];
    pruneOrphans(TREE, defs, alloc);
  }
}

// ---- tooltip values / formatting

function valueAt(def, rank) {
  const unit = (def.unit || 'none').toLowerCase();
  const suffix = unit === 'percent' ? '%' :
                 unit === 'seconds' ? 's' :
                 unit === 'energy'  ? '/s' : '';

  // totals
  if (Array.isArray(def.totals)) {
    const idx = Math.max(0, Math.min(rank, def.totals.length - 1));
    return { total: def.totals[idx], suffix };
  }
  // increments
  if (Array.isArray(def.increments)) {
    const base = Number(def.base || 0);
    const sum  = def.increments.slice(0, Math.max(0, rank)).reduce((a, b) => a + Number(b || 0), 0);
    return { total: base + sum, suffix };
  }
  // linear
  const base = Number(def.base || 0);
  const inc  = Number(def.perRank || 0);
  return { total: base + inc * Math.max(0, rank), suffix };
}

// One-decimal formatting with special cases
function fmt(n, suffix = '') {
  if (suffix === 's')  return Math.abs(n) < 1e-9 ? '0' : n.toFixed(1); // seconds
  if (suffix === '%')  return n.toFixed(1);                             // percent
  if (suffix === '/s') return Math.abs(n) < 1e-9 ? '0' : n.toFixed(1);  // energy per second
  return Math.abs(n % 1) > 1e-9 ? n.toFixed(1) : String(n);             // default
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---- share / persistence

const LS_KEY = 'dr-skill-build';

function makeShareUrl() {
  const payload = { v: 1, cls: currentClass, lvl: level, a: alloc };
  const b64 = toUrlSafe(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  const url = new URL(location.href);
  url.searchParams.set('b', b64);
  return url.toString();
}
function loadFromUrl() {
  const b = new URL(location.href).searchParams.get('b');
  if (!b) return false;
  try {
    const json = decodeURIComponent(escape(atob(fromUrlSafe(b))));
    const obj = JSON.parse(json);
    if (obj.cls && data.classes[obj.cls]) currentClass = obj.cls;
    TREE = data.classes[currentClass];
    if (Number.isFinite(obj.lvl)) level = clamp(obj.lvl, 1, 100);
    alloc = (obj.a && typeof obj.a === 'object') ? obj.a : {};
    return true;
  } catch { return false; }
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify({ cls: currentClass, lvl: level, a: alloc })); }
function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (obj.cls && data.classes[obj.cls]) currentClass = obj.cls;
    TREE = data.classes[currentClass];
    if (Number.isFinite(obj.lvl)) level = clamp(obj.lvl, 1, 100);
    alloc = (obj.a && typeof obj.a === 'object') ? obj.a : {};
    return true;
  } catch { return false; }
}

// ---- misc

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function toUrlSafe(s) { return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,''); }
function fromUrlSafe(s) { return s.replace(/-/g, '+').replace(/_/g, '/'); }
