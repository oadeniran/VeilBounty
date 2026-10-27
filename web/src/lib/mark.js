// "Ribbon Light" behaviour for the folded-V mark (design workspace page 3).
// CSS does the drawing; this file only: tilts the mark toward the pointer on hover-capable devices,
// pauses every loop while the mark is off-screen or the tab is hidden, and never runs under reduced motion.
import { prefersReducedMotion } from './dom.js';

const io = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => { for (const e of entries) e.target.classList.toggle('is-paused', !e.isIntersecting); })
  : null;

export function watchMark(markEl) {
  if (!markEl) return markEl;
  if (io) io.observe(markEl);
  return markEl;
}

export function setMarkStage(markEl, stage) {
  if (!markEl || markEl.dataset.stage === stage) return;
  markEl.dataset.stage = stage;
  // Restart one-shot animations (sweep on proof ready, landing on reward) by re-inserting the node's animation.
  if (stage === 'verify' || stage === 'reward') { markEl.classList.add('is-restart'); void markEl.offsetWidth; markEl.classList.remove('is-restart'); }
}

// Pointer tilt: up to 8° Y / 6° X, eased in CSS. rAF-throttled. Detaches with the returned function.
export function bindTilt(hostEl, markEl) {
  if (!hostEl || !markEl || prefersReducedMotion()) return () => {};
  let hover = false; try { hover = window.matchMedia('(hover: hover)').matches; } catch { /* no matchMedia */ }
  if (!hover) return () => {};
  let raf = 0;
  const move = (e) => {
    const r = hostEl.getBoundingClientRect();
    const mx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const my = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { markEl.style.setProperty('--mx', mx.toFixed(3)); markEl.style.setProperty('--my', my.toFixed(3)); });
  };
  const leave = () => { cancelAnimationFrame(raf); markEl.style.setProperty('--mx', '0'); markEl.style.setProperty('--my', '0'); };
  hostEl.addEventListener('pointermove', move);
  hostEl.addEventListener('pointerleave', leave);
  return () => { hostEl.removeEventListener('pointermove', move); hostEl.removeEventListener('pointerleave', leave); };
}

document.addEventListener('visibilitychange', () => {
  for (const m of document.querySelectorAll('.vx-mark')) m.classList.toggle('is-hidden-tab', document.hidden);
});
