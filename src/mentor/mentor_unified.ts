import './mentor_unified.css';
import { reactTodoLessons } from './react_todo_course';

type Tab = 'plan' | 'create' | 'teach' | 'check';
type Planner = {
  planSoftware?: (request: { goal: string; rootPath: string; projectName: string; files: string[] }) => Promise<{ plan: string }>;
  restoreProject: () => Promise<{ rootPath: string; projectName: string; files: string[] } | null>;
};
const stacks: ReadonlyArray<{ id: string; title: string; template: string }> = [
  { id: 'react-ts', title: 'React + TypeScript', template: 'react-ts' },
  { id: 'react', title: 'React + JavaScript', template: 'react' },
  { id: 'vue-ts', title: 'Vue + TypeScript', template: 'vue-ts' },
  { id: 'vue', title: 'Vue + JavaScript', template: 'vue' },
  { id: 'flutter', title: 'Flutter + Dart', template: '' },
] as const;

function install(): boolean {
  const panel = document.getElementById('mentor-course-panel');
  const body = panel?.querySelector<HTMLElement>('.mentor-course-body');
  const heading = panel?.querySelector<HTMLElement>('.mentor-course-heading');
  const toggle = document.getElementById('mentor-course-toggle') as HTMLButtonElement | null;
  if (!panel || !body || !heading || !toggle || !window.tutorIde) return false;
  if (panel.dataset.mentorUnified === 'true') return true;
  const mentorPanel = panel;
  const mentorBody = body;
  const mentorToggle = toggle;
  panel.dataset.mentorUnified = 'true';
  panel.classList.add('mentor-unified');
  const tabBar = document.createElement('nav');
  tabBar.className = 'mentor-unified-tabs';
  tabBar.setAttribute('aria-label', 'AI 开发导师功能');
  tabBar.innerHTML = `
    <button type="button" data-unified-tab="plan">AI 开发</button>
    <button type="button" data-unified-tab="create">创建项目</button>
    <button type="button" data-unified-tab="teach">逐步教学</button>
    <button type="button" data-unified-tab="check">检查代码</button>
  `;
  heading.insertAdjacentElement('afterend', tabBar);
  const extra = document.createElement('section');
  extra.className = 'mentor-unified-content';
  tabBar.insertAdjacentElement('afterend', extra);
  extra.innerHTML = `
    <section data-unified-view="plan" hidden>
      <strong>你想开发什么软件？</strong>
      <p>告诉我软件用途与主要功能，我会结合当前项目生成开发规划。</p>
      <textarea data-unified-goal rows="3" maxlength="2000" placeholder="例如：订单管理系统，包含商品、客户和报表"></textarea>
      <button type="button" class="primary-button" data-unified-plan>生成 AI 规划</button>
      <p class="mentor-unified-note" data-unified-plan-status role="status"></p>
      <div class="mentor-unified-plan-output" data-unified-output hidden></div>
    </section>
    <section data-unified-view="create" hidden>
      <strong>创建新项目</strong>
      <label>技术组合<select data-unified-stack></select></label>
      <label>项目名称<input data-unified-name value="my-new-project" maxlength="60" autocomplete="off" spellcheck="false" /></label>
      <p class="mentor-unified-note">使用官方 CLI 命令，每条独立复制；创建后用「在 IDE 打开」切换项目。</p>
      <div data-unified-commands></div>
      <p data-unified-create-status class="mentor-unified-note" role="status"></p>
    </section>
    <section data-unified-view="check" hidden>
      <strong>检查当前教学步骤</strong>
      <p data-unified-check-file></p>
      <button type="button" class="primary-button" data-unified-check-action>检查代码</button>
      <p class="mentor-unified-note" data-unified-check-status role="status"></p>
    </section>
  `;
  const guided = document.createElement('section');
  guided.dataset.unifiedView = 'teach';
  guided.hidden = true;
  guided.innerHTML = `<strong data-generated-heading>AI 已生成代码</strong>
    <p data-generated-intro></p>
    <div class="mentor-generated-location" data-generated-location></div>
    <button type="button" class="primary-button" data-generated-open>打开当前文件</button>
    <p data-generated-description></p>
    <div class="mentor-generated-actions">
      <button type="button" data-generated-previous>上一个文件</button>
      <button type="button" data-generated-next>下一个文件</button>
    </div>
    <button type="button" data-generated-continue>继续开发 / 提出新需求</button>`;
  extra.append(guided);
  const guidedIntro = guided.querySelector<HTMLElement>('[data-generated-intro]')!;
  const guidedLocation = guided.querySelector<HTMLElement>('[data-generated-location]')!;
  const guidedDescription = guided.querySelector<HTMLElement>('[data-generated-description]')!;
  const guidedOpen = guided.querySelector<HTMLButtonElement>('[data-generated-open]')!;
  const guidedPrevious = guided.querySelector<HTMLButtonElement>('[data-generated-previous]')!;
  const guidedNext = guided.querySelector<HTMLButtonElement>('[data-generated-next]')!;
  const guidedContinue = guided.querySelector<HTMLButtonElement>('[data-generated-continue]')!;
  const api = window.tutorIde as Planner;
  const stack = extra.querySelector<HTMLSelectElement>('[data-unified-stack]')!;
  const name = extra.querySelector<HTMLInputElement>('[data-unified-name]')!;
  const commands = extra.querySelector<HTMLElement>('[data-unified-commands]')!;
  const createStatus = extra.querySelector<HTMLElement>('[data-unified-create-status]')!;
  const checkFile = extra.querySelector<HTMLElement>('[data-unified-check-file]')!;
  const checkStatus = extra.querySelector<HTMLElement>('[data-unified-check-status]')!;
  const checkAction = extra.querySelector<HTMLButtonElement>('[data-unified-check-action]')!;
  const originalVerify = body.querySelector<HTMLButtonElement>('[data-mentor-verify]');
  const originalMessage = body.querySelector<HTMLElement>('[data-mentor-message]');
  const progress = body.querySelector<HTMLElement>('[data-mentor-progress]');
  const fileButton = document.createElement('button');
  fileButton.type = 'button';
  fileButton.className = 'mentor-unified-open-file';
  fileButton.textContent = '打开当前步骤文件';
  const filePrompt = document.createElement('div');
  filePrompt.className = 'mentor-unified-file-prompt';
  filePrompt.innerHTML = `<strong data-unified-file-prompt></strong>`;
  filePrompt.append(fileButton);
  body.insertBefore(filePrompt, body.firstChild);
  const fileLabel = filePrompt.querySelector<HTMLElement>('[data-unified-file-prompt]')!;
  let active: Tab = 'plan';
  let currentPath = '';
  let currentRoot = '';
  let currentFiles: string[] = [];
  let generatedFiles: string[] = [];
  let generatedIndex = 0;
  let generatedSummary = '';

  const badge = document.getElementById('workspace-badge');
  const root = document.getElementById('project-root');
  function realProject(): boolean {
    const badgeText = badge?.textContent?.trim() ?? '';
    return badgeText === '真实项目' || badgeText === 'Real Project';
  }
  function lessonIndex(): number {
    const text = progress?.textContent ?? '';
    const found = /第\s*(\d+)/.exec(text);
    return Math.max(0, Math.min(reactTodoLessons.length - 1, Number(found?.[1] ?? 1) - 1));
  }
  function refreshFile(): void {
    const lesson = reactTodoLessons[lessonIndex()];
    currentPath = lesson?.file ?? '';
    fileLabel.textContent = currentPath ? `现在请打开：${currentPath}` : '先选择一个教学步骤';
    checkFile.textContent = currentPath ? `当前需要检查：${currentPath}` : '没有可检查的文件';
    const exists = realProject() && currentFiles.includes(currentPath);
    fileButton.disabled = !exists;
    filePrompt.title = exists ? '' : '项目中尚无此文件，请先创建或打开正确的项目';
    if (!exists && realProject()) fileLabel.textContent += '（当前项目尚无此文件）';
  }
  function openGeneratedFile(): void {
    const path = generatedFiles[generatedIndex];
    if (!path) return;
    window.dispatchEvent(new CustomEvent('ai-ide-reader-jump-request', {
      detail: { filePath: path, line: 1 },
    }));
  }
  function renderGeneratedGuide(): void {
    const path = generatedFiles[generatedIndex];
    if (!path) return;
    guidedIntro.textContent = generatedSummary;
    guidedLocation.textContent = `第 ${generatedIndex + 1} / ${generatedFiles.length} 个文件：${path}`;
    guidedDescription.textContent = `现在请查看 ${path}。机器人已经为你定位该文件。先阅读这段源码，下一步可以切换到其他生成文件，或继续提出功能需求。`;
    guidedPrevious.disabled = generatedIndex === 0;
    guidedNext.disabled = generatedIndex >= generatedFiles.length - 1;
  }
  guidedOpen.addEventListener('click', openGeneratedFile);
  guidedPrevious.addEventListener('click', () => {
    if (generatedIndex > 0) { generatedIndex--; renderGeneratedGuide(); openGeneratedFile(); }
  });
  guidedNext.addEventListener('click', () => {
    if (generatedIndex + 1 < generatedFiles.length) { generatedIndex++; renderGeneratedGuide(); openGeneratedFile(); }
  });
  guidedContinue.addEventListener('click', () => setTab('plan'));
  window.addEventListener('code-tutor-ai-coding-finished', (event) => {
    const detail = (event as CustomEvent<{ files?: string[]; summary?: string }>).detail;
    const files = detail?.files?.filter(file => typeof file === 'string' && file.length > 0) ?? [];
    if (!files.length) return;
    generatedFiles = files;
    generatedIndex = 0;
    generatedSummary = detail?.summary ?? '';
    setTab('teach');
  });
  function setTab(tab: Tab): void {
    active = tab;
    mentorPanel.dataset.unifiedTab = tab;
    for (const button of Array.from(tabBar.querySelectorAll<HTMLButtonElement>('[data-unified-tab]'))) {
      const selected = button.dataset.unifiedTab === tab;
      button.dataset.active = String(selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    mentorBody.hidden = tab !== 'teach' || generatedFiles.length > 0;
    for (const view of Array.from(extra.querySelectorAll<HTMLElement>('[data-unified-view]'))) {
      view.hidden = view.dataset.unifiedView !== tab;
    }
    extra.hidden = tab === 'teach' && generatedFiles.length === 0;
    refreshFile();
    if (tab === 'teach' && generatedFiles.length > 0) renderGeneratedGuide();
    if (tab === 'teach' && realProject()) {
      mentorBody.classList.add('mentor-unified-teaching-open');
    }
  }
  function show(tab: Tab): void {
    if (mentorPanel.hidden) mentorToggle.click();
    setTab(tab);
  }
  tabBar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-unified-tab]');
    if (button?.dataset.unifiedTab) setTab(button.dataset.unifiedTab as Tab);
  });
  fileButton.addEventListener('click', () => {
    if (!currentFiles.includes(currentPath)) return;
    window.dispatchEvent(new CustomEvent('ai-ide-reader-jump-request', { detail: { filePath: currentPath, line: 1 } }));
  });
  stack.replaceChildren(...stacks.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.title;
    return option;
  }));
  function renderCommands(): void {
    commands.replaceChildren();
    const value = name.value.trim();
    const flutter = stack.value === 'flutter';
    const valid = flutter ? /^[a-z][a-z0-9_]{0,59}$/.test(value)
      : /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(value);
    if (!valid) { createStatus.textContent = '请输入有效项目名称（Flutter 只接受小写字母、数字和下划线）。'; return; }
    createStatus.textContent = '';
    const template = stacks.find(item => item.id === stack.value)?.template || 'react-ts';
    const lines = flutter ? [`flutter create --project-name ${value} ${value}`, `cd ${value}`]
      : [`npm create vite@latest ${value} -- --template ${template}`, `cd ${value}`, 'npm install'];
    for (const line of lines) {
      const row = document.createElement('div'); row.className = 'mentor-unified-command-row';
      const command = document.createElement('code'); command.textContent = `PS> ${line}`;
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制';
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(line).then(() => { copy.textContent = '已复制'; })
          .catch(() => { createStatus.textContent = '复制失败，请选择命令手动复制。'; });
      });
      row.append(command, copy); commands.append(row);
    }
  }
  stack.addEventListener('change', renderCommands);
  name.addEventListener('input', renderCommands);
  renderCommands();
  // The planning view now contains the AI interview and code generation flow.
  // Do not run the older text-only planner.
  checkAction.addEventListener('click', () => { originalVerify?.click(); });
  if (originalMessage) new MutationObserver(() => { checkStatus.textContent = originalMessage.textContent ?? ''; })
    .observe(originalMessage, { childList: true, characterData: true, subtree: true });
  if (progress) new MutationObserver(refreshFile).observe(progress, { childList: true, characterData: true, subtree: true });
  async function refreshProject(): Promise<void> {
    if (!realProject()) { currentFiles = []; currentRoot = ''; refreshFile(); return; }
    try {
      const snapshot = await api.restoreProject();
      if (!snapshot) return;
      const changed = currentRoot !== snapshot.rootPath;
      currentRoot = snapshot.rootPath;
      currentFiles = snapshot.files;
      refreshFile();
      if (changed) {
        const key = `code-tutor-unified-asked:${snapshot.rootPath.toLowerCase()}`;
        if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); show('plan'); }
      }
    } catch { /* No project yet */ }
  }
  for (const item of [badge, root]) if (item) new MutationObserver(() => { void refreshProject(); })
    .observe(item, { childList: true, characterData: true, subtree: true });
  // Show the same unified window for existing menu and top AI entry.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const existing = target.closest('[data-robot-action]');
    if (existing) {
      const action = (existing as HTMLElement).dataset.robotAction;
      if (action === 'create' || action === 'teach') {
        event.preventDefault(); event.stopImmediatePropagation();
        document.getElementById('mentor-robot-actions')?.setAttribute('hidden', '');
        show(action === 'create' ? 'create' : 'teach');
      }
    }
    if (target.closest('#software-goal-open')) {
      event.preventDefault(); event.stopImmediatePropagation(); show('plan');
    }
  }, true);
  // Keep click on the animated robot in one UI rather than a second menu.
  document.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.mentor-robot-hitbox')) {
      event.preventDefault(); event.stopImmediatePropagation();
      show('plan');
    }
  }, true);
  window.addEventListener('code-tutor-unified-open', (event) => {
    const tab = (event as CustomEvent<{ tab?: Tab }>).detail?.tab;
    show(tab ?? 'plan');
  });
  // Existing single-purpose prompt must not occupy a second visible window.
  const old = document.getElementById('software-goal-dialog');
  if (old) old.hidden = true;
  void refreshProject();
  setTab('plan');
  return true;
}
function bootstrap(): void {
  if (install()) return;
  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
