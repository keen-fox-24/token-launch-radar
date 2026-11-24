// Token Launch Radar — dashboard logic. Renders window.RADAR (written by main.ts as
// ../data.js) with no network: a sortable, filterable board, a per-protocol detail view,
// and the live-peer anchor table the value model is read from.
// Routes: #/ board · #/filter/<category> board pre-filtered · #/protocol/<slug> detail.
'use strict';

const R = window.RADAR;
const app = document.getElementById('app');
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function usd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n;
}
function pct(x) {
  if (x === null || x === undefined) return '<span class="chips">n/a</span>';
  const cls = x >= 0 ? 'up' : 'down';
  return `<span class="${cls}">${x >= 0 ? '+' : ''}${x.toFixed(1)}%</span>`;
}

function renderStats() {
  const m = R.meta;
  document.getElementById('stats').innerHTML = [
    [m.protocols_scanned, 'protocols scanned'],
    [m.pre_token_tracked, 'pre-token tracked'],
    [m.board_size, 'on the board'],
    [m.watchlist_size + '/' + m.watchlist_size, 'watchlist covered'],
    [m.as_of, 'snapshot date'],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
}

const state = { q: '', cat: '', chain: '', watchOnly: false, sort: 'rank', dir: 1 };

function categories() {
  return [...new Set(R.rows.map((r) => r.category || 'Uncategorised'))].sort();
}
function chains() {
  return [...new Set(R.rows.flatMap((r) => r.chains))].sort();
}

function visibleRows() {
  let rows = R.rows.filter((r) => {
    if (state.q && !(r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q))) return false;
    if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.watchOnly && !r.watchlist) return false;
    return true;
  });
  const key = {
    rank: (r) => r.rank,
    implied: (r) => r.implied_value_usd,
    tvl: (r) => r.tvl_usd,
    change: (r) => (r.change_7d === null ? -Infinity : r.change_7d),
    score: (r) => r.radar_score,
  }[state.sort];
  rows = [...rows].sort((a, b) => (key(a) - key(b)) * state.dir);
  return rows;
}

function boardHTML() {
  const m = R.meta;
  const anchorRows = R.anchors.slice(0, 8).map((a) => `
    <tr>
      <td>${esc(a.category)}</td>
      <td class="num">${a.live_peers}</td>
      <td class="num">${a.median_multiple.toFixed(2)}x</td>
      <td>${esc(a.example)} <span class="mini">(${a.example_multiple.toFixed(2)}x)</span></td>
    </tr>`).join('');
  return `
  <section class="panel">
    <div class="controls">
      <input type="search" id="q" placeholder="Search protocol or slug" value="${esc(state.q)}">
      <select id="cat"><option value="">All categories</option>${categories().map((c) => `<option ${c === state.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="chain"><option value="">All chains</option>${chains().map((c) => `<option ${c === state.chain ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label><input type="checkbox" id="watch" ${state.watchOnly ? 'checked' : ''}> Watchlist only</label>
      <select id="sort">
        ${[['rank', 'Sort: radar rank'], ['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['change', 'Sort: 7d change'], ['score', 'Sort: radar score']]
          .map(([v, l]) => `<option value="${v}" ${v === state.sort ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <p class="count-line" id="count"></p>
    <table>
      <thead><tr>
        <th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th>
        <th class="num">TVL</th><th class="num">7d</th><th class="num">Implied value</th>
        <th class="num">Peer x</th><th class="num">Score</th><th>Farm plan</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </section>
  <section class="panel">
    <h2>How the radar values a launch</h2>
    <div class="formula">implied value = TVL x live peer multiple x growth x maturity x chain breadth</div>
    <p>The peer multiple is the <b>median market-cap / TVL of protocols in the same category whose token
    already trades</b> — the live anchors below, computed from this snapshot's own ${m.live_protocols} trading
    protocols (global median ${m.global_median_multiple.toFixed(2)}x). Growth scales the 7-day TVL change
    (clamped), maturity rewards a longer tokenless track record, chain breadth adds a small bonus per extra
    chain. Below the $${(m.floor_usd / 1e6).toFixed(0)}M watchlist floor, wrapped, staked and bridged products of
    tokens that already trade, and exchange balance sheets, are set aside entirely — the same judgement the
    watchlist rule makes — because their value belongs to a token that already trades, not a new launch.</p>
    <table class="anchor-table">
      <thead><tr><th>Category</th><th class="num">Live peers</th><th class="num">Median mcap/TVL</th><th>Richest live peer</th></tr></thead>
      <tbody>${anchorRows}</tbody>
    </table>
  </section>`;
}

function rowHTML(r) {
  return `<tr data-slug="${esc(r.slug)}">
    <td class="num rank">${r.rank}</td>
    <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge watch">watchlist</span>' : ''}</td>
    <td>${esc(r.category || 'Uncategorised')}</td>
    <td class="chips">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</td>
    <td class="num">${usd(r.tvl_usd)}</td>
    <td class="num">${pct(r.change_7d)}</td>
    <td class="num"><b>${usd(r.implied_value_usd)}</b></td>
    <td class="num">${r.peer_multiple.toFixed(2)}x</td>
    <td class="num"><span class="score">${r.radar_score}</span></td>
    <td><a href="#/protocol/${esc(r.slug)}">${r.farm_steps.length} steps</a></td>
  </tr>`;
}

function paintBoard() {
  const rows = visibleRows();
  document.getElementById('count').textContent =
    `${rows.length} of ${R.rows.length} board protocols shown — click a row for its detail view and farm plan.`;
  document.getElementById('tbody').innerHTML = rows.map(rowHTML).join('');
  document.querySelectorAll('#tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => { location.hash = '#/protocol/' + tr.dataset.slug; });
  });
}

function wireBoard() {
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('q', 'input', (e) => { state.q = e.target.value.trim().toLowerCase(); paintBoard(); });
  on('cat', 'change', (e) => { state.cat = e.target.value; paintBoard(); });
  on('chain', 'change', (e) => { state.chain = e.target.value; paintBoard(); });
  on('watch', 'change', (e) => { state.watchOnly = e.target.checked; paintBoard(); });
  on('sort', 'change', (e) => { state.sort = e.target.value; state.dir = state.sort === 'rank' ? 1 : -1; paintBoard(); });
  paintBoard();
}

function factorBar(label, value, max) {
  const w = Math.max(2, Math.min(100, (value / max) * 100));
  return `<div class="bar-row"><span class="lbl">${esc(label)}</span><span class="bar"><i style="width:${w}%"></i></span><span class="val">x${value.toFixed(2)}</span></div>`;
}

function detailHTML(r) {
  const anchor = R.anchors.find((a) => a.category === (r.category || 'Uncategorised'));
  const neighbours = R.rows.filter((x) => Math.abs(x.rank - r.rank) <= 2 && x.slug !== r.slug)
    .map((x) => `<a href="#/protocol/${esc(x.slug)}">#${x.rank} ${esc(x.name)} (${usd(x.implied_value_usd)})</a>`)
    .join(' · ');
  return `
  <a class="back" href="#/">← back to the board</a>
  <section class="panel">
    <div class="detail-head">
      <h2>#${r.rank} ${esc(r.name)}</h2>
      ${r.watchlist ? '<span class="badge watch">on the $' + (R.meta.floor_usd / 1e6).toFixed(0) + 'M+ watchlist</span>' : '<span class="badge">early find below the floor</span>'}
      <span class="badge">${esc(r.category || 'Uncategorised')}</span>
    </div>
    <p class="mini">${esc(r.name)} records no token in the ${esc(R.meta.as_of)} snapshot. If it issued one and the market
    priced it like its live category peers, the radar's estimate is:</p>
    <div class="big-value">${usd(r.implied_value_usd)}</div>
    <div class="grid">
      <div class="cell"><span>TVL</span><b>${usd(r.tvl_usd)}</b></div>
      <div class="cell"><span>7d TVL change</span><b>${r.change_7d === null ? 'n/a' : r.change_7d.toFixed(1) + '%'}</b></div>
      <div class="cell"><span>Chains</span><b>${esc(r.chains.join(', ') || '—')}</b></div>
      <div class="cell"><span>Tracked since</span><b>${esc(r.listed_at || 'unknown')}</b></div>
      <div class="cell"><span>Tokenless track record</span><b>${r.age_years === null ? 'unknown' : r.age_years.toFixed(1) + ' years'}</b></div>
      <div class="cell"><span>Radar score</span><b>${r.radar_score} / 100</b></div>
    </div>
    <h2>How this value is built</h2>
    ${factorBar('Live peer multiple (' + esc(r.category || 'Uncategorised') + ')', r.peer_multiple, 3)}
    ${factorBar('Growth (7d TVL)', r.growth_factor, 1.6)}
    ${factorBar('Maturity (tokenless years)', r.maturity_factor, 1.2)}
    ${factorBar('Chain breadth', r.chain_factor, 1.2)}
    ${r.product_factor < 1 ? factorBar('Wrapped/staked product discount', r.product_factor, 1.2) : ''}
    <p class="mini">TVL ${usd(r.tvl_usd)} x ${r.peer_multiple.toFixed(2)} peer multiple x the factors above = ${usd(r.implied_value_usd)}.
    ${anchor && anchor.live_peers >= 3
      ? `Its category's live anchor: ${anchor.live_peers} trading peers, median ${anchor.median_multiple.toFixed(2)}x, richest ${esc(anchor.example)} at ${anchor.example_multiple.toFixed(2)}x.`
      : `Its category has ${anchor ? anchor.live_peers : 0} trading peer${anchor && anchor.live_peers === 1 ? '' : 's'} in the snapshot — too few for a category median — so the global live median ${R.meta.global_median_multiple.toFixed(2)}x is used as its peer multiple.`}</p>
  </section>
  <section class="panel">
    <h2>Farm plan — what to do about ${esc(r.name)}</h2>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="mini">Neighbouring ranks: ${neighbours}</p>
  </section>`;
}

function route() {
  const hash = location.hash || '#/';
  const proto = hash.match(/^#\/protocol\/(.+)$/);
  if (proto) {
    const r = bySlug.get(decodeURIComponent(proto[1]));
    if (r) { app.innerHTML = detailHTML(r); window.scrollTo(0, 0); return; }
  }
  const filt = hash.match(/^#\/filter\/(.+)$/);
  if (filt) state.cat = decodeURIComponent(filt[1]);
  app.innerHTML = boardHTML();
  wireBoard();
  window.scrollTo(0, 0);
}

renderStats();
window.addEventListener('hashchange', route);
route();
