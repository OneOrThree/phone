(function attachGromoMockupShared(global) {
  const gripDots = [
    [7, 5],
    [13, 5],
    [7, 11],
    [13, 11],
    [7, 17],
    [13, 17],
    [7, 23],
    [13, 23],
  ]
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.5"></circle>`)
    .join('');

  const gripIcon = `
    <svg class="reorder-grip" viewBox="0 0 20 28" aria-hidden="true" focusable="false">
      ${gripDots}
    </svg>`;

  function escapeAttribute(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function reorderHandle({ label, className = 'reorder-handle' }) {
    return `<button class="${escapeAttribute(className)}" type="button" data-shared-reorder-handle="true" aria-label="${escapeAttribute(label)}">${gripIcon}</button>`;
  }

  global.GromoMockupShared = Object.freeze({
    reorderHandle,
  });
})(window);
