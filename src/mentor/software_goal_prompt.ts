import './software_goal_prompt.css';

type PlanApi = typeof window.tutorIde & {
  planSoftware?: (request: {
    goal: string;
    rootPath: string;
    projectName: string;
    files: string[];
  }) => Promise<{ plan: string }>;
};

function install(): boolean {
  const bar = document.querySelector<HTMLElement>('.commandbar');
  if (!bar || !window.tutorIde) return false;
  if (document.getElementById('software-goal-open')) return true;

  const open = document.createElement('button');
  open.id = 'software-goal-open';
  open.type = 'button';
  open.textContent = '\u{1F916} AI \u8F6F\u4EF6\u89C4\u5212';
  open.title = '\u544A\u8BC9\u673A\u5668\u4EBA\u4F60\u60F3\u5F00\u53D1\u4EC0\u4E48\u8F6F\u4EF6';
  bar.append(open);

  const dialog = document.createElement('section');
  dialog.id = 'software-goal-dialog';
  dialog.className = 'software-goal-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', '\u8F6F\u4EF6\u89C4\u5212');
  dialog.innerHTML = `
    <div class="software-goal-heading">
      <strong>\u{1F916} \u4F60\u60F3\u505A\u4EC0\u4E48\u8F6F\u4EF6\uFF1F</strong>
      <button type="button" data-goal-close aria-label="\u5173\u95ED">\u00D7</button>
    </div>
    <p>\u544A\u8BC9\u6211\u4F60\u7684\u60F3\u6CD5\uFF0C\u6211\u4F1A\u5148\u89C4\u5212\u529F\u80FD\u548C\u5F00\u53D1\u6B65\u9AA4\u3002\u4E0D\u4F1A\u81EA\u52A8\u4FEE\u6539\u4EE3\u7801\u3002</p>
    <textarea data-goal-text rows="3" maxlength="2000" placeholder="\u4F8B\u5982\uFF1A\u6211\u60F3\u505A\u4E00\u4E2A\u6709\u767B\u5F55\u3001\u8BA2\u5355\u548C\u62A5\u8868\u7684\u7BA1\u7406\u7CFB\u7EDF"></textarea>
    <div class="software-goal-actions">
      <button type="button" data-goal-plan class="primary-button">\u8BA9 AI \u89C4\u5212</button>
      <button type="button" data-goal-teach>\u8FDB\u5165\u9879\u76EE\u6559\u5B66</button>
    </div>
    <p data-goal-status role="status" aria-live="polite"></p>
    <pre data-goal-plan-output hidden></pre>
  `;
  document.body.append(dialog);
  const close = dialog.querySelector<HTMLButtonElement>('[data-goal-close]')!;
  const text = dialog.querySelector<HTMLTextAreaElement>('[data-goal-text]')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[data-goal-plan]')!;
  const teach = dialog.querySelector<HTMLButtonElement>('[data-goal-teach]')!;
  const status = dialog.querySelector<HTMLElement>('[data-goal-status]')!;
  const output = dialog.querySelector<HTMLElement>('[data-goal-plan-output]')!;

  let activeRoot = '';
  function getRoot(): string {
    const badge = document.getElementById('workspace-badge')?.textContent?.trim();
    if (badge !== '\u771F\u5B9E\u9879\u76EE' && badge !== 'Real Project') return '';
    const root = document.getElementById('project-root')?.textContent?.trim() || '';
    return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(root) ? root : '';
  }
  function show(): void {
    dialog.hidden = false;
    text.focus();
  }
  function hide(): void {
    dialog.hidden = true;
  }
  open.addEventListener('click', show);
  close.addEventListener('click', hide);
  teach.addEventListener('click', () => {
    hide();
    document.getElementById('mentor-course-toggle')?.click();
  });

  function refresh(): void {
    const root = getRoot();
    if (!root || root === activeRoot) return;
    activeRoot = root;
    status.textContent = '';
    output.hidden = true;
    output.textContent = '';
    text.value = '';
    const key = 'code-tutor-software-goal-asked:' + root.toLowerCase();
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      show();
    }
  }
  const observer = new MutationObserver(refresh);
  const badge = document.getElementById('workspace-badge');
  const rootElement = document.getElementById('project-root');
  if (badge) observer.observe(badge, { childList: true, subtree: true });
  if (rootElement) observer.observe(rootElement, { childList: true, subtree: true });
  window.setTimeout(refresh, 400);
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });

  submit.addEventListener('click', async () => {
    const goal = text.value.trim();
    if (!goal) { status.textContent = '\u8BF7\u5148\u63CF\u8FF0\u4F60\u60F3\u505A\u7684\u8F6F\u4EF6\u3002'; text.focus(); return; }
    if (!activeRoot) activeRoot = getRoot();
    if (!activeRoot) { status.textContent = '\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u672C\u5730\u9879\u76EE\u3002'; return; }
    const api = window.tutorIde as PlanApi;
    if (!api.planSoftware) { status.textContent = '\u5F53\u524D IDE \u7248\u672C\u4E0D\u652F\u6301 AI \u8F6F\u4EF6\u89C4\u5212\u3002'; return; }
    submit.disabled = true;
    output.hidden = true;
    status.textContent = '\u6B63\u5728\u751F\u6210\u5F00\u53D1\u8BA1\u5212\u2026';
    try {
      const rootPath = activeRoot;
      const projectName = rootPath.split(/[\\/]/).filter(Boolean).pop() || 'project';
      const result = await api.planSoftware({
        goal, rootPath, projectName, files: [],
      });
      if (activeRoot !== rootPath) return;
      output.textContent = result.plan;
      output.hidden = false;
      status.textContent = '\u5DF2\u751F\u6210\u8BA1\u5212\u3002\u53EF\u4EE5\u4FEE\u6539\u9700\u6C42\u540E\u518D\u6B21\u89C4\u5212\u3002';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      submit.disabled = false;
    }
  });
  return true;
}

function bootstrap(): void {
  if (install()) return;
  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
