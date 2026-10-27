// Homepage: static content first (works without JavaScript), then live values from the campaign API.
import '../styles/fonts.css';
import '../styles/ds-patterns.css';
import '../styles/ds-components.css';
import '../styles/home.css';
import { bindTilt, watchMark } from '../lib/mark.js';
import { campaignWords } from '../app/copy.js';

const $ = (s) => document.querySelector(s);
const bind = (key, text) => { for (const el of document.querySelectorAll(`[data-bind="${key}"]`)) el.textContent = text; };

// Menu for narrow widths.
const btn = $('#hp-menu-btn'), menu = $('#hp-menu');
const close = () => { btn.setAttribute('aria-expanded', 'false'); menu.hidden = true; };
btn.addEventListener('click', () => { const open = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(open)); menu.hidden = !open; if (open) menu.querySelector('a')?.focus(); });
menu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close(); });

for (const m of document.querySelectorAll('.vx-mark')) watchMark(m);
bindTilt($('#hp-hero'), $('#hp-mark'));

async function getJson(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

(async () => {
  try {
    const info = await getJson('/api/campaign');
    const w = campaignWords(info);
    bind('reward', w.reward);
    bind('buyer', info.manifest.buyer.name);
    bind('purpose', w.purpose);
    bind('retention', `${w.retention}, no resale — campaign terms`);
    bind('retention-days', w.retention);
    bind('title-tag', `${w.adj[0].toUpperCase()}${w.adj.slice(1)} spending · ${w.month ? `${w.month} ${info.manifest.period.from.slice(0, 4)}` : w.period}`);
    bind('question', `“Did this participant spend between ${w.range.replace('–', ' and ')} on ${w.category}${w.month ? ` during ${w.month}` : ` between ${w.period}`}?”`);
    if (info.payout_adapter?.name === 'manual') { bind('payout-tag', 'Payout sent manually by the operator'); bind('payout-rail', 'Manual mode · operator-reported transaction'); }
    const s = await getJson('/api/buyer/summary');
    const live = document.querySelector('[data-bind="live"]');
    const left = Math.max(0, s.max_participants - s.accepted_claims);
    live.textContent = `Live from this server: ${s.accepted_claims.toLocaleString('en-US')} verified ${s.accepted_claims === 1 ? 'answer' : 'answers'} so far · ${left.toLocaleString('en-US')} places left. Counts only; no answer carries records.`;
    live.hidden = false;
  } catch { /* static content stays; the page still works without the API */ }
})();
