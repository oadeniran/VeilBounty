// Demo page entry: boot, header, section routing (#claim / #lab / #history) and the local-data chip.
import '../styles/fonts.css';
import '../styles/ds-patterns.css';
import '../styles/ds-components.css';
import '../styles/app.css';
import { h, $, $$, mount, bytesLabel } from '../lib/dom.js';
import { msg } from '../lib/components.js';
import { S, subscribe } from './store.js';
import { api, onNet, privateBytesSent } from './net.js';
import { call } from './prover.js';
import { campaignWords, explain } from './copy.js';
import { initClaim } from './claim.js';
import { renderLab } from './lab.js';
import { renderHistory } from './history.js';

const VIEWS = ['claim', 'lab', 'history'];

function updateChip() {
  const chipEl = $('#local-chip'); if (!chipEl) return;
  const proving = S.proof.status === 'running';
  const sent = privateBytesSent();
  chipEl.dataset.state = sent ? 'leak' : proving ? 'proving' : 'idle';
  mount(chipEl,
    h('span.vx-dot', { class: proving ? 'vx-dot--live' : sent ? 'vx-dot--bad' : null, 'aria-hidden': 'true' }),
    h('span', h('b.chip__k', proving ? 'Proving on this device' : 'On this device'), h('span.chip__sep', ' · '),
      bytesLabel(sent), h('span.chip__long', ' of records'), ' sent'));
}

function route(initial = false) {
  const want = location.hash.replace('#', '');
  const view = VIEWS.includes(want) ? want : 'claim';
  const changedView = S.view !== view;
  S.view = view;
  for (const v of VIEWS) {
    $(`#view-${v}`).hidden = v !== view;
    for (const a of $$(`[data-nav="${v}"]`)) { if (v === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  }
  document.body.dataset.view = view;
  closeMenu();
  const focus = !initial && changedView;
  if (view === 'lab') renderLab($('#view-lab'), { focus });
  if (view === 'history') renderHistory($('#view-history'), { focus });
  if (view === 'claim' && focus) $('#view-claim [data-stage-heading]')?.focus({ preventScroll: true });
  if (focus) window.scrollTo({ top: 0, behavior: 'instant' });
}

// Section menu for widths under 1100 px (responsive board: section links move into a menu button).
function closeMenu() { const b = $('#menu-btn'); if (b) { b.setAttribute('aria-expanded', 'false'); $('#app-menu').hidden = true; } }
function setupMenu() {
  const b = $('#menu-btn'); const menu = $('#app-menu');
  b.addEventListener('click', () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); menu.hidden = !open; if (open) menu.querySelector('a')?.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && b.getAttribute('aria-expanded') === 'true') { closeMenu(); b.focus(); } });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && !b.contains(e.target)) closeMenu(); });
}

let raf = 0;
function refreshLive(what) {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    updateChip();
    if (S.view === 'history') renderHistory();
    if (S.view === 'lab' && (what === 'stage' || what === 'payout')) renderLab();
  });
}

async function boot() {
  setupMenu();
  updateChip();
  onNet(() => refreshLive('net'));
  subscribe((what) => refreshLive(what));
  let r;
  try { r = await api('GET', '/api/campaign', undefined, { purpose: 'Load campaign terms' }); } catch (e) { r = { status: 0, body: null }; }
  if (r.status !== 200 || !r.body?.manifest) {
    mount($('#view-claim'), h('div.boot-error', msg('error', 'The campaign could not be loaded', `${explain(r.status === 0 ? 'network_error' : `http_${r.status}`)} Reload the page to try again.`)));
    return;
  }
  S.info = r.body; S.words = campaignWords(S.info);
  initClaim($('#view-claim'));
  window.addEventListener('hashchange', () => route());
  route(true);
  // Warm the prover in the background: downloads the public prover engine and parameters from this site only.
  call('init').then(() => { S.proverInit = 'ready'; }).catch((e) => { S.proverInit = 'failed'; S.proverError = e.message; });
}

boot();
