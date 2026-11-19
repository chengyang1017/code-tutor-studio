import './handson_compact.css';

function installCompactTeachingUi(): void {
  const panel = document.getElementById('mentor-course-panel');
  const view = panel?.querySelector<HTMLElement>('#handson-mode-view');
  const step = view?.querySelector<HTMLElement>('.handson-step');
  if (!view || !step || view.dataset.compactTeachingInstalled === 'true') return;
  view.dataset.compactTeachingInstalled = 'true';

  const example = step.querySelector<HTMLElement>('.handson-example');
  if (example) {
    const details = document.createElement('details');
    details.className = 'handson-code-details';
    const summary = document.createElement('summary');
    summary.textContent = '查看参考代码（需要时展开）';
    details.append(summary);
    example.parentElement?.insertBefore(details, example);
    details.append(example);
    const observer = new MutationObserver(() => { details.open = false; });
    observer.observe(example, { characterData: true, childList: true, subtree: true });
  }

  const verify = step.querySelector<HTMLButtonElement>('.handson-verify');
  const next = step.querySelector<HTMLButtonElement>('.handson-next');
  if (verify && next) {
    const actions = document.createElement('div');
    actions.className = 'handson-sticky-actions';
    actions.append(verify, next);
    view.append(actions);
    const sync = () => view.classList.toggle('handson-has-step', !step.hidden);
    sync();
    new MutationObserver(sync).observe(step, { attributes: true, attributeFilter: ['hidden'] });
  }
}

function initialize(): void {
  installCompactTeachingUi();
  const observer = new MutationObserver(() => {
    if (!document.querySelector('#handson-mode-view[data-compact-teaching-installed="true"]')) {
      installCompactTeachingUi();
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
