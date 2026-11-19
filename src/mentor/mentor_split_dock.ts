import './mentor_split_dock.css';

// One shared mentor panel: floating or adjustable side-by-side dock.
function installMentorSplitDock(): boolean {
  const panel = document.getElementById('mentor-course-panel');
  const stage = document.getElementById('editor-stage');
  const heading = panel?.querySelector<HTMLElement>('.mentor-course-heading');
  if (!panel || !stage || !heading) return false;
  if (panel.dataset.mentorSplitInstalled === 'true') return true;
  panel.dataset.mentorSplitInstalled = 'true';

  const originalParent = panel.parentElement || document.body;
  let button = heading.querySelector<HTMLButtonElement>('.mentor-split-toggle');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'mentor-split-toggle';
    const close = heading.querySelector('[data-mentor-close]');
    if (close) heading.insertBefore(button, close);
    else heading.append(button);
  }
  button.title = 'Switch between floating and adjustable split view';

  const divider = document.createElement('div');
  divider.className = 'mentor-split-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize AI teaching panel');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.tabIndex = 0;
  stage.append(divider);

  let docked = false;
  let percent = 50; // mentor pane width as percentage of the editor stage
  const minWidth = 210;
  function clampPercent(value: number): number {
    const width = stage!.getBoundingClientRect().width;
    if (width <= minWidth * 2) return 50;
    const lower = (minWidth / width) * 100;
    return Math.max(lower, Math.min(100 - lower, value));
  }
  function updateWidth(next: number): void {
    percent = clampPercent(next);
    stage!.style.setProperty('--mentor-panel-percent', `${percent}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(percent)));
    divider.setAttribute('aria-valuemin', String(Math.ceil(clampPercent(0))));
    divider.setAttribute('aria-valuemax', String(Math.floor(clampPercent(100))));
    window.dispatchEvent(new Event('resize'));
  }
  function sync(): void {
    stage!.classList.toggle('mentor-split-enabled', docked && !panel!.hidden);
    button!.textContent = docked ? '↗ 浮动' : '⇄ 半屏';
    button!.setAttribute('aria-pressed', String(docked));
  }
  function setDocked(next: boolean): void {
    if (docked === next) return;
    docked = next;
    panel!.style.removeProperty('left');
    panel!.style.removeProperty('top');
    panel!.style.removeProperty('right');
    panel!.style.removeProperty('bottom');
    if (docked) {
      delete panel!.dataset.userPositioned;
      stage!.append(panel!);
      updateWidth(percent);
    } else {
      originalParent.append(panel!);
    }
    sync();
    window.dispatchEvent(new Event('resize'));
  }
  button.addEventListener('click', () => setDocked(!docked));

  divider.addEventListener('pointerdown', (event: PointerEvent) => {
    if (!docked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    divider.setPointerCapture(event.pointerId);
    divider.classList.add('mentor-split-resizing');
  });
  divider.addEventListener('pointermove', (event: PointerEvent) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const rect = stage!.getBoundingClientRect();
    if (!rect.width) return;
    updateWidth((rect.right - event.clientX) / rect.width * 100);
  });
  function finishDrag(event: PointerEvent): void {
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    divider.classList.remove('mentor-split-resizing');
  }
  divider.addEventListener('pointerup', finishDrag);
  divider.addEventListener('pointercancel', finishDrag);
  divider.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!docked) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      updateWidth(percent + (event.key === 'ArrowLeft' ? 3 : -3));
    } else if (event.key === 'Home') {
      event.preventDefault(); updateWidth(70);
    } else if (event.key === 'End') {
      event.preventDefault(); updateWidth(30);
    }
  });

  // The floating-window drag handler must not move a docked panel.
  heading.addEventListener('pointerdown', (event: PointerEvent) => {
    if (!docked) return;
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    event.stopImmediatePropagation();
  }, true);
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(() => {
    if (docked) updateWidth(percent);
  }).observe(stage);
  updateWidth(percent);
  sync();
  return true;
}
function bootMentorSplitDock(): void {
  if (installMentorSplitDock()) return;
  const observer = new MutationObserver(() => {
    if (installMentorSplitDock()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMentorSplitDock, { once: true });
} else bootMentorSplitDock();
