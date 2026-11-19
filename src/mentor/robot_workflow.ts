import './robot_workflow.css';

// A separate, guided robot entry point. The existing lesson system remains intact.
type ScaffoldKind = 'react-ts' | 'react-js' | 'flutter';
type ParsedCommand = { name: string; template: ScaffoldKind };

function parseCreatorCommand(input: string): ParsedCommand | null {
  const command = input.trim();
  let result = /^npm\s+create\s+vite@latest\s+([A-Za-z0-9][A-Za-z0-9_-]{0,59})\s+--\s+--template\s+(react-ts|react)$/i.exec(command);
  if (result) return { name: result[1]!, template: result[2]!.toLowerCase() === 'react-ts' ? 'react-ts' : 'react-js' };
  result = /^flutter\s+create\s+([a-z][a-z0-9_]*)$/.exec(command);
  if (result && result[1]!.length <= 60) return { name: result[1]!, template: 'flutter' };
  return null;
}

function installRobotWorkflow(): boolean {
  const robot = document.getElementById('tutor-character')!;
  const stage = document.getElementById('editor-stage')!;
  if (!robot || !stage || !window.tutorIde) return false;
  if (document.getElementById('robot-workflow-click')) return true;

  const clickTarget = document.createElement('button');
  clickTarget.id = 'robot-workflow-click';
  clickTarget.type = 'button';
  clickTarget.setAttribute('aria-label', '打开机器人选项');
  clickTarget.title = '点击机器人选择操作';
  clickTarget.hidden = true;

  const menu = document.createElement('section');
  menu.id = 'robot-workflow-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '机器人操作引导');
  menu.innerHTML = `
    <div class="robot-workflow-head">
      <span>🤖 <strong>机器人助手</strong></span>
      <button type="button" data-rw-close aria-label="关闭">×</button>
    </div>
    <p data-rw-speech class="robot-workflow-speech" aria-live="polite"></p>
    <div data-rw-actions class="robot-workflow-actions"></div>
    <div data-rw-form class="robot-workflow-form" hidden>
      <label for="robot-workflow-command">官方项目创建指令</label>
      <textarea id="robot-workflow-command" rows="3" spellcheck="false">npm create vite@latest my-new-project -- --template react-ts</textarea>
      <small>支持 Vite 的 react-ts / react，以及 flutter create。指令由 IDE 解析并执行对应官方创建流程，不运行任意 Shell 内容。</small>
      <div class="robot-workflow-commands">
        <button type="button" data-rw-example="react-ts">React TS</button>
        <button type="button" data-rw-example="react-js">React JS</button>
        <button type="button" data-rw-example="flutter">Flutter</button>
      </div>
      <div class="robot-workflow-actions">
        <button type="button" data-rw-back>← 返回</button>
        <button type="button" data-rw-submit class="robot-workflow-primary">确认并创建</button>
      </div>
    </div>
  `;
  document.body.append(clickTarget, menu);
  const actions = menu.querySelector<HTMLElement>('[data-rw-actions]')!;
  const speech = menu.querySelector<HTMLElement>('[data-rw-speech]')!;
  const form = menu.querySelector<HTMLElement>('[data-rw-form]')!;
  const command = menu.querySelector<HTMLTextAreaElement>('#robot-workflow-command')!;
  const submit = menu.querySelector<HTMLButtonElement>('[data-rw-submit]')!;
  let opened = false;
  let busy = false;
  let animationId = 0;
  let stageTimer = 0;
  let stageToken = 0;

  function tell(message: string): void {
    speech.textContent = message;
    robot.classList.remove('robot-workflow-animated');
    void robot.offsetWidth;
    robot.classList.add('robot-workflow-animated');
  }
  function setActions(options: Array<[string, string]>): void {
    form.hidden = true;
    actions.hidden = false;
    actions.replaceChildren();
    options.forEach(([id, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rwAction = id;
      button.textContent = label;
      actions.append(button);
    });
    menu.classList.remove('robot-workflow-enter');
    void menu.offsetWidth;
    menu.classList.add('robot-workflow-enter');
  }
  function later(task: () => void): void {
    window.clearTimeout(stageTimer);
    const token = ++stageToken;
    stageTimer = window.setTimeout(() => { if (opened && token === stageToken) task(); }, 320);
  }
  function mainOptions(): void {
    tell('你好！我可以解析当前项目，也可以带你创建新项目。请选择一个操作。');
    setActions([
      ['analyze', '🧠 解析当前项目'],
      ['create', '✨ 创建新项目'],
      ['teach', '📘 项目教学'],
    ]);
  }
  function creationOptions(): void {
    tell('新项目可以通过官方创建指令生成，也可以直接从模板列表中选择。');
    setActions([
      ['command', '⌨ 使用指令创建'],
      ['template', '📂 使用模板创建'],
      ['back', '← 返回机器人选项'],
    ]);
  }
  function show(): void {
    if (opened) return;
    opened = true;
    menu.hidden = false;
    clickTarget.setAttribute('aria-expanded', 'true');
    position();
    mainOptions();
  }
  function hide(): void {
    if (busy) return;
    opened = false;
    menu.hidden = true;
    clickTarget.setAttribute('aria-expanded', 'false');
    window.clearTimeout(stageTimer);
    ++stageToken;
    robot.classList.remove('robot-workflow-animated');
  }
  function position(): void {
    const rect = robot.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const l = Math.max(rect.left, stageRect.left);
    const t = Math.max(rect.top, stageRect.top);
    const r = Math.min(rect.right, stageRect.right);
    const b = Math.min(rect.bottom, stageRect.bottom);
    if (robot.classList.contains('offscreen') || r <= l || b <= t) {
      clickTarget.hidden = true;
      if (opened && !busy) hide();
      return;
    }
    clickTarget.hidden = false;
    Object.assign(clickTarget.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
    if (!opened) return;
    const menuWidth = menu.offsetWidth || 320;
    const menuHeight = menu.offsetHeight || 260;
    const right = rect.right + 16;
    const left = rect.left - menuWidth - 16;
    const x = right + menuWidth <= window.innerWidth - 12 ? right : Math.max(12, left);
    const y = Math.min(Math.max(12, rect.top - 32), Math.max(12, window.innerHeight - menuHeight - 12));
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
  }
  function animationLoop(): void { position(); animationId = window.requestAnimationFrame(animationLoop); }
  animationId = window.requestAnimationFrame(animationLoop);

  clickTarget.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (opened) hide(); else show();
  });
  menu.querySelector('[data-rw-close]')!.addEventListener('click', hide);
  menu.querySelector('[data-rw-back]')!.addEventListener('click', creationOptions);
  menu.querySelectorAll<HTMLButtonElement>('[data-rw-example]').forEach((item) => {
    item.addEventListener('click', () => {
      const examples: Record<string, string> = {
        'react-ts': 'npm create vite@latest my-new-project -- --template react-ts',
        'react-js': 'npm create vite@latest my-new-project -- --template react',
        flutter: 'flutter create my_flutter_app',
      };
      command.value = examples[item.dataset.rwExample ?? 'react-ts'] ?? examples['react-ts']!;
      command.focus();
    });
  });
  actions.addEventListener('click', (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-rw-action]')?.dataset.rwAction;
    if (!choice || busy) return;
    if (choice === 'back') { mainOptions(); return; }
    if (choice === 'create') { tell('好的，我来帮你准备创建项目的方式……'); later(creationOptions); return; }
    if (choice === 'command') {
      tell('请填写你想执行的官方创建指令。我会先验证，再让你选择保存位置。');
      actions.hidden = true; form.hidden = false; command.focus(); return;
    }
    if (choice === 'template') {
      hide();
      window.dispatchEvent(new Event('code-tutor-open-project-creator'));
      return;
    }
    if (choice === 'analyze') {
      const analyze = document.querySelector<HTMLButtonElement>('#ai-tour');
      if (!analyze || analyze.disabled) { tell('请先打开真实项目，然后我才能分析整个项目。'); return; }
      tell('我会沿着项目的代码关系移动，逐步讲解当前项目。');
      later(() => { hide(); analyze.click(); });
      return;
    }
    if (choice === 'teach') {
      tell('我们开始项目教学，我会一步一步引导你。');
      later(() => { hide(); document.querySelector<HTMLButtonElement>('#mentor-course-toggle')?.click(); });
    }
  });
  submit.addEventListener('click', async () => {
    if (busy) return;
    const parsed = parseCreatorCommand(command.value);
    if (!parsed) {
      tell('指令格式不支持。请选择上面的示例，然后修改项目名；目前只支持 React/Vite 和 Flutter 官方创建命令。');
      command.focus(); return;
    }
    if (typeof window.tutorIde.createTemplateProject !== 'function') {
      tell('当前环境没有提供本地项目创建功能。请使用 Electron 桌面版。'); return;
    }
    if (!window.confirm(`即将执行官方创建流程：\n${command.value.trim()}\n\nIDE 会要求选择保存位置。继续吗？`)) return;
    busy = true; submit.disabled = true;
    tell('请选择项目保存位置。创建器会执行相应官方命令，等待依赖安装完成后才打开项目。');
    try {
      const result = await window.tutorIde.createTemplateProject({ name: parsed.name, template: parsed.template });
      if (result) window.location.reload();
      else tell('已取消创建，没有切换项目。');
    } catch (error) {
      tell(error instanceof Error ? error.message : '项目创建失败，请检查官方 SDK 与网络连接。');
    } finally { busy = false; submit.disabled = false; }
  });
  document.addEventListener('pointerdown', (event) => {
    if (opened && !busy && !menu.contains(event.target as Node) && !clickTarget.contains(event.target as Node)) hide();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  window.addEventListener('beforeunload', () => {
    window.cancelAnimationFrame(animationId);
    window.clearTimeout(stageTimer);
  }, { once: true });
  return true;
}
function bootstrapRobotWorkflow(): void {
  if (installRobotWorkflow()) return;
  const observer = new MutationObserver(() => { if (installRobotWorkflow()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrapRobotWorkflow, { once: true });
else bootstrapRobotWorkflow();
