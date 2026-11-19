import './mentor_create_toggle.css';

// In an already-open project the setup commands are a secondary action.
// Nothing is executed or overwritten by this UI controller.
function install(): boolean {
  const panel = document.getElementById('mentor-course-panel');
  const progress = panel?.querySelector<HTMLElement>('[data-mentor-progress]');
  const body = panel?.querySelector<HTMLElement>('.mentor-course-body');
  const instruction = panel?.querySelector<HTMLElement>('[data-mentor-instruction]');
  const stackSelector = panel?.querySelector<HTMLSelectElement>('#mentor-course-select');
  if (!panel || !body || !progress || !instruction || !stackSelector) return false;
  if (panel.dataset.creatorToggleReady === 'true') return true;
  panel.dataset.creatorToggleReady = 'true';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mentor-create-toggle';
  toggle.textContent = '\u2795 \u521b\u5efa\u65b0\u9879\u76ee';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'mentor-course-select');
  const description = document.createElement('p');
  description.className = 'mentor-create-toggle-note';
  description.textContent = '\u5df2\u6253\u5f00\u9879\u76ee\u3002\u9700\u8981\u65b0\u9879\u76ee\u65f6\u518d\u5c55\u5f00\u521b\u5efa\u9009\u9879\u3002';
  const wrapper = document.createElement('div');
  wrapper.className = 'mentor-create-toggle-wrap';
  wrapper.append(toggle, description);
  const selectorLabel = body.querySelector('label[for="mentor-course-select"]');
  body.insertBefore(wrapper, selectorLabel ?? body.firstChild);

  let expanded = false;
  function isProjectOpen(): boolean {
    const badge = document.getElementById('workspace-badge')?.textContent?.trim();
    return badge === '\u771f\u5b9e\u9879\u76ee' || badge === 'Real Project';
  }
  function onSetupStep(): boolean {
    return /^\u7b2c\s*1\s*\//.test(progress!.textContent?.trim() ?? '');
  }
  function refresh(): void {
    const showToggle = isProjectOpen() && onSetupStep();
    wrapper.hidden = !showToggle;
    panel!.classList.toggle('mentor-create-collapsed', showToggle && !expanded);
    toggle.textContent = expanded
      ? '\u6536\u8d77\u521b\u5efa\u9009\u9879'
      : '\u2795 \u521b\u5efa\u65b0\u9879\u76ee';
    toggle.setAttribute('aria-expanded', String(expanded));
    description.hidden = expanded;
  }
  toggle.addEventListener('click', () => {
    expanded = !expanded;
    refresh();
  });
  const watched = [progress, document.getElementById('workspace-badge'), document.getElementById('project-root')];
  const observer = new MutationObserver(refresh);
  for (const target of watched) {
    if (target) observer.observe(target, { childList: true, characterData: true, subtree: true });
  }
  refresh();
  return true;
}
function bootstrap(): void {
  if (install()) return;
  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
