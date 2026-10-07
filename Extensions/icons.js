// VibeyCursor inline SVG icon set — single coherent language.
// 16x16 viewBox, 1.8px stroke, round caps, currentColor. No dependency.
// Usage: VIBEY_ICONS.history / vibeyIcon('history', 'vc-ico').
(function () {
  function svg(paths) {
    return `<svg class="vc-ico" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }
  const VIBEY_ICONS = {
    history: svg('<path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9"/><path d="M2.5 8V5.5M2.5 8h2.5"/><path d="M8 5v3.2l2.2 1.3"/>'),
    spark: svg('<path d="M8 1.8l1.3 3.9 3.9 1.3-3.9 1.3L8 12.2l-1.3-3.9-3.9-1.3 3.9-1.3z"/><path d="M12.5 11.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    check: svg('<path d="M2.5 8.5l3.5 3.5 7-8"/>'),
    checkCircle: svg('<circle cx="8" cy="8" r="6"/><path d="M5.5 8.2l1.8 1.8 3.2-3.8"/>'),
    box: svg('<path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z"/><path d="M8 1.8v5.4M2.7 4.9l10.6 6M13.3 4.9l-10.6 6"/>'),
    frame: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/>'),
    copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10h1.5"/>'),
    code: svg('<path d="M6 4L2.5 8 6 12"/><path d="M10 4l3.5 4L10 12"/>'),
    trash: svg('<path d="M2.5 4h11"/><path d="M6.5 4V2.8A.8.8 0 0 1 7.3 2h1.4a.8.8 0 0 1 .8.8V4"/><path d="M4 4l.7 9a1.5 1.5 0 0 0 1.5 1.4h3.6A1.5 1.5 0 0 0 11.3 13L12 4"/>'),
    chevL: svg('<path d="M10 3L5 8l5 5"/>'),
    chevR: svg('<path d="M6 3l5 5-5 5"/>'),
    arrowR: svg('<path d="M2.5 8h11"/><path d="M10 4.5L13.5 8 10 11.5"/>'),
  };
  function vibeyIcon(name) {
    return VIBEY_ICONS[name] || '';
  }
  globalThis.VIBEY_ICONS = VIBEY_ICONS;
  globalThis.vibeyIcon = vibeyIcon;
})();
