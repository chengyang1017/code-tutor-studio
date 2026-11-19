import './mentor_redesign.css';

function installMentorWholeScroll(): boolean {
  const panel = document.getElementById('mentor-course-panel');
  const stage = document.getElementById('editor-stage');
  if (!panel || !stage) return false;
  if (panel.dataset.wholeWheelInstalled === 'true') return true;
  panel.dataset.wholeWheelInstalled = 'true';

  // Capture the wheel before older embedded scrollers can swallow it.
  panel.addEventListener('wheel', (event: WheelEvent) => {
    if (!stage.classList.contains('mentor-split-enabled') || panel.hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Native input scrolling remains native when editing long answers.
    if (target.closest('textarea, select, input, [contenteditable="true"]')) return;
    const max = Math.max(0, panel.scrollHeight - panel.clientHeight);
    if (max <= 0) return;
    let amount = event.deltaY;
    if (event.deltaMode === 1) amount *= 20;
    if (event.deltaMode === 2) amount *= panel.clientHeight;
    if (amount === 0) return;
    const next = Math.min(max, Math.max(0, panel.scrollTop + amount));
    if (next === panel.scrollTop) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    panel.scrollTop = next;
  }, { capture: true, passive: false });

  // Opening a different mode should show its beginning, not preserve the
  // previous mode's scroll location.
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.attributeName === 'data-unified-tab')) panel.scrollTop = 0;
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['data-unified-tab'] });
  return true;
}
function bootMentorWholeScroll(): void {
  if (installMentorWholeScroll()) return;
  const observer = new MutationObserver(() => {
    if (installMentorWholeScroll()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootMentorWholeScroll, { once: true });
else bootMentorWholeScroll();
