import './inline_scroll_guard.css';

// Keep wheel events inside the Monaco content widget rather than scrolling the editor.
// The widget is anchored to a code position, so editor scroll can visually move it.
function installInlineScrollGuard(): void {
  document.addEventListener('wheel', (event: WheelEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest<HTMLElement>('.inline-copilot-widget');
    if (!card || card.classList.contains('inline-copilot-hidden')) return;

    // Monaco's editor consumes wheel events. Own the scroll while the mouse is on the card.
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();

    const deltaScale = event.deltaMode === 1 ? 18
      : event.deltaMode === 2 ? card.clientHeight : 1;
    const deltaY = event.deltaY * deltaScale;
    const deltaX = event.deltaX * deltaScale;

    // Scroll nested code blocks first, then fall back to the entire card.
    const candidates: HTMLElement[] = [];
    let current: Element | null = target;
    while (current && current !== card) {
      if (current instanceof HTMLElement) candidates.push(current);
      current = current.parentElement;
    }
    candidates.push(card);

    let remainingY = deltaY;
    let remainingX = deltaX;
    for (const element of candidates) {
      if (Math.abs(remainingY) > 0.1) {
        const available = Math.max(0, element.scrollHeight - element.clientHeight);
        if (available > 1) {
          const before = element.scrollTop;
          element.scrollTop = Math.max(0, Math.min(available, before + remainingY));
          remainingY -= element.scrollTop - before;
        }
      }
      if (Math.abs(remainingX) > 0.1) {
        const available = Math.max(0, element.scrollWidth - element.clientWidth);
        if (available > 1) {
          const before = element.scrollLeft;
          element.scrollLeft = Math.max(0, Math.min(available, before + remainingX));
          remainingX -= element.scrollLeft - before;
        }
      }
      if (Math.abs(remainingY) < 0.1 && Math.abs(remainingX) < 0.1) break;
    }
  }, { capture: true, passive: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installInlineScrollGuard, { once: true });
} else {
  installInlineScrollGuard();
}
