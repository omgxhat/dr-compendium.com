// Global state
const VERSION = '10'; 
let items = [];
const synonymsMap = {};
let selectedCategories = new Set();
let selectedSubCategories = new Set();
let selectedTiers = new Set();
let selectedRarities = new Set();
let selectedZone = null;
let searchTerm = '';

// Map for icon filenames
const ICONS = {
  starter_sword: 'wood_sword_normal.png',
  starter_shield: 'shield.png',
  starter_helmet: 'leather_helmet_normal.png',
  starter_chestplate: 'leather_chestplate_normal.png',
  starter_leggings: 'leather_leggings_normal.png',
  starter_boots: 'leather_boots_normal.png',
  t1_helmet:   'leather_helmet.gif',
  t1_chest:    'leather_chestplate.gif',
  t1_leggings: 'leather_pants.gif',
  t1_boots:    'leather_boots.gif',
  t1_scythe:   'wood_hoe.gif',
  t1_sword:    'wood_sword.gif',
  t1_axe:      'wood_axe.gif',
  t1_mace:     'wood_shovel.gif',
  t2_helmet:   'chain_helmet.gif',
  t2_chest:    'chain_chestplate.gif',
  t2_leggings: 'chain_leggings.gif',
  t2_boots:    'chain_boots.gif',
  t2_scythe:   'stone_hoe.gif',
  t2_sword:    'stone_sword.gif',
  t2_axe:      'stone_axe.gif',
  t2_mace:     'stone_shovel.gif',
  t3_helmet:   'iron_helmet.gif',
  t3_chest:    'iron_chestplate.gif',
  t3_leggings: 'iron_leggings.gif',
  t3_boots:    'iron_boots.gif',
  t3_scythe:   'iron_hoe.gif',
  t3_sword:    'iron_sword.gif',
  t3_axe:      'iron_axe.gif',
  t3_mace:     'iron_shovel.gif',
  t4_helmet:   'diamond_helmet.gif',
  t4_chest:    'diamond_chestplate.gif',
  t4_leggings: 'diamond_leggings.gif',
  t4_boots:    'diamond_boots.gif',
  t4_scythe:   'diamond_hoe.gif',
  t4_sword:    'diamond_sword.gif',
  t4_axe:      'diamond_axe.gif',
  t4_mace:     'diamond_shovel.gif',
  t5_helmet:   'gold_helmet.gif',
  t5_chest:    'gold_chestplate.gif',
  t5_leggings: 'gold_leggings.gif',
  t5_boots:    'gold_boots.gif',
  t5_scythe:   'gold_hoe.gif',
  t5_sword:    'gold_sword.gif',
  t5_axe:      'gold_axe.gif',
  t5_mace:     'gold_shovel.gif',
  bow:         'bow.gif'
};

// Entry point: load data and initialize app
async function init() {
  try {
    // Load and process keywords
    const kwRes = await fetch(`data/keywords.json?v=${VERSION}`, { cache: 'no-store' });
    if (!kwRes.ok) throw new Error(kwRes.statusText);
    const kwData = await kwRes.json();
    if (Array.isArray(kwData)) {
      kwData.forEach(k => synonymsMap[k.toLowerCase()] = k.toLowerCase());
    } else {
      Object.entries(kwData).forEach(([canon, syns]) => {
        const lcCanon = canon.toLowerCase();
        synonymsMap[lcCanon] = lcCanon;
        syns.forEach(s => synonymsMap[s.toLowerCase()] = lcCanon);
      });
    }


    // Load and flatten items
const itRes = await fetch(`data/items.json?v=${VERSION}`,     { cache: 'no-store' });
if (!itRes.ok) throw new Error(itRes.statusText);
const grouped = await itRes.json();

items = [];
Object.entries(grouped).forEach(([slug, group]) => {
  const { drops_from, location, is_chaotic, ...pieces } = group;
  const isUltimate = /^ultimate_/i.test(slug);
  Object.values(pieces).forEach(item => {
    items.push({
      ...item,
      drops_from,
      location,
      is_chaotic: String(is_chaotic),
      group_slug: slug,
      is_ultimate: isUltimate
    });
  });
});

    attachListeners();
    render();
  } catch (err) {
    console.error('Init error:', err);
  }
}

// Bind UI event handlers
function attachListeners() {
  document.querySelectorAll('[data-filter-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleSet(selectedCategories, btn.dataset.filterCategory, btn);
      render();
    });
  });

  document.querySelectorAll('[data-filter-subcategory]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleSet(selectedSubCategories, btn.dataset.filterSubcategory, btn);
      render();
    });
  });

  document.querySelectorAll('[data-filter-tier]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleSet(selectedTiers, btn.dataset.filterTier, btn);
      render();
    });
  });
  // rarity buttons
document.querySelectorAll('[data-filter-rarity]').forEach(btn => {
  btn.addEventListener('click', () => {
    toggleSet(selectedRarities, btn.dataset.filterRarity.toLowerCase(), btn);
    render();
  });
});

  document.querySelectorAll('[data-filter-zone]').forEach(btn => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.filterZone;
      if (selectedZone === z) {
        selectedZone = null;
        btn.classList.remove('active');
      } else {
        selectedZone = z;
        document.querySelectorAll('[data-filter-zone]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      render();
    });
  });

  const searchInput = document.getElementById('search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchTerm = e.target.value.trim().toLowerCase();
      render();
    });
  }
}

// Toggle a value in a Set and update button state
function toggleSet(set, val, btn) {
  if (set.has(val)) {
    set.delete(val);
    btn.classList.remove('active');
  } else {
    set.add(val);
    btn.classList.add('active');
  }
}

// Filter items and render the grid
function render() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.innerHTML = '';

  const toDisplay = items.filter(it => {
    if (selectedCategories.size && !selectedCategories.has(it.category)) return false;
    if (selectedSubCategories.size && !selectedSubCategories.has(it.sub_category)) return false;
    if (selectedTiers.size && !selectedTiers.has(String(it.tier))) return false;
if (selectedZone) {
  const zone = it.is_chaotic === 'true' ? 'chaotic' : 'lawful';
  if (zone !== selectedZone) return false;
}

if (selectedRarities.size) {
  const r = String(it.rarity || '').trim().toLowerCase();
  const isUlt = !!it.is_ultimate;
  const match = selectedRarities.has(r) || (selectedRarities.has('ultimate') && isUlt);
  if (!match) return false;
}

    if (searchTerm) {
      const haystack = [
        it.name, it.drops_from, it.location,
        it.main_stat_1, it.main_stat_2, it.main_stat_3,
        it.sub_stat_1, it.sub_stat_2, it.sub_stat_3, it.sub_stat_4,
        it.sub_stat_5, it.sub_stat_6
      ].join(' ').toLowerCase();
      const term = synonymsMap[searchTerm] || searchTerm;
      return haystack.includes(term);
    }
    return true;
  });

  toDisplay.forEach(it => grid.appendChild(makeCard(it)));
}

// Construct a card element for an item
function makeCard(it) {
  const card = document.createElement('div');
  card.className = `card tier-${it.tier}`;

  // add rarity + ultimate classes
  if (it.rarity) card.classList.add(`rarity-${String(it.rarity).toLowerCase()}`);
  if (it.is_ultimate) card.classList.add('ultimate');

  // Icon
  const img = document.createElement('img');
  const fileName = ICONS[it.img] || `${it.img}.gif`;
  img.src     = `./images/items/${fileName}?v=${VERSION}`;
  img.alt = it.name;
  img.className = 'item-image';
  card.appendChild(img);

  // Basic info
  const info = document.createElement('div');
  info.innerHTML = `
    <p class="item-name">${it.name}</p>
    <p class="item-tier">Tier ${it.tier}</p>
    <p class="item-level">Level ${it.level}</p>
  `;
  card.appendChild(info);

  // Details panel
  const details = document.createElement('div');
  details.className = 'details';

  [1,2,3].forEach(i => {
    const stat = it[`main_stat_${i}`];
    if (stat) {
      const p = document.createElement('p');
      p.className = 'main-stat';
      p.textContent = stat;
      details.appendChild(p);
    }
  });

  [1,2,3,4,5,6].forEach(i => {
    const stat = it[`sub_stat_${i}`];
    if (stat) {
      const p = document.createElement('p');
      p.className = 'sub-stat';
      p.textContent = stat;
      details.appendChild(p);
    }
  });

  const r = document.createElement('p');
  r.className = 'rarity';
  r.textContent = it.rarity;
  details.appendChild(r);

  const lore = document.createElement('p');
  lore.className = 'lore';
  lore.textContent = it.lore;
  details.appendChild(lore);

  // Tooltip icon
  const icoCt = document.createElement('div');
  icoCt.className = 'info-icon-container';
  const infoImg = document.createElement('img');
  infoImg.src = `images/mobs/t${it.tier}_mob.png?v=${VERSION}`;
  infoImg.className = 'info-icon';
  icoCt.appendChild(infoImg);

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.innerHTML = `
    <strong>Drops From:</strong> ${it.drops_from}<br>
    <strong>Location:</strong> ${it.location}
    <span class="zone ${it.is_chaotic==='true'?'chaotic':'lawful'}">
      ${it.is_chaotic==='true'?'Chaotic Zone':'Lawful Zone'}
    </span>
  `;
  icoCt.appendChild(tip);
  details.appendChild(icoCt);

  // Toggle details visibility
  card.addEventListener('click', () => details.classList.toggle('open'));
  card.appendChild(details);

  return card;
}

// Start the application
init();
