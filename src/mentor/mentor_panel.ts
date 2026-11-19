import './mentor_panel.css';
import { reactTodoLessons } from './react_todo_course';

type Snapshot = { rootPath: string; files: string[]; projectName: string };
type Api = {
  restoreProject: () => Promise<Snapshot | null>;
  readProjectFile: (path: string) => Promise<{ content: string }>;
};

const STORAGE_KEY = 'code-tutor-project-mentor-v1';

function status(message: string): void {
  const element = document.getElementById('tutor-status');
  if (element) element.textContent = message;
}

const FOCUS_BY_LESSON: Record<string, RegExp> = {
  setup: /"scripts"|"dependencies"/,
  component: /function\s+App|const\s+App|<h1/,
  state: /useState|function\s+App/,
  input: /<input|setInput|function\s+App/,
  add: /setTasks|<button|function\s+App/,
  list: /\.map\s*\(|function\s+App/,
  remove: /\.filter\s*\(|function\s+App/,
  style: /button|input|li/,
};

function focusLine(id: string, content: string): number {
  const pattern = FOCUS_BY_LESSON[id];
  const lines = content.split(/\r?\n/);
  const found = lines.findIndex((line) => pattern?.test(line));
  return Math.max(1, found + 1);
}

function robotMove(path: string, line: number, speech: string): void {
  window.dispatchEvent(new CustomEvent('ai-ide-mentor-focus', {
    detail: { filePath: path, line, speech },
  }));
}

function install(): boolean {
  const commandBar = document.querySelector<HTMLElement>('.commandbar');
  const workspace = document.querySelector<HTMLElement>('.workspace');
  if (!commandBar || !workspace || !window.tutorIde?.restoreProject) return false;
  if (document.getElementById('mentor-course-panel')) return true;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'mentor-course-toggle';
  button.textContent = '🤖 项目教学';
  button.title = '从项目创建开始，逐步学习源码';
  const group = document.createElement('div');
  group.className = 'command-group';
  group.append(button);
  commandBar.append(group);

  const panel = document.createElement('aside');
  panel.id = 'mentor-course-panel';
  panel.className = 'mentor-course-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="mentor-course-heading">
      <div><strong>🤖 项目教学</strong><small>从零创建 · 逐步编码 · 验证成果</small></div>
      <button type="button" data-mentor-close aria-label="关闭项目教学">×</button>
    </div>
    <div class="mentor-course-body">
      <label for="mentor-course-select">选择项目</label>
      <select id="mentor-course-select">
        <option value="react-todo">React + TypeScript Todo List</option>
        <option value="flutter-todo" disabled>Flutter Todo（即将支持）</option>
        <option value="oms" disabled>订单管理系统（即将支持）</option>
      </select>
      <div class="mentor-course-progress">
        <span data-mentor-progress>第 1 步</span>
        <progress data-mentor-meter max="8" value="0"></progress>
      </div>
      <h3 data-mentor-title></h3>
      <p data-mentor-objective></p>
      <div class="mentor-course-message" data-mentor-message role="status" aria-live="polite"></div>
      <h4>机器人讲解</h4>
      <p data-mentor-explanation></p>
      <h4>你的任务</h4>
      <pre data-mentor-instruction></pre>
      <div class="mentor-course-checks" data-mentor-checks></div>
      <div class="mentor-course-actions">
        <button type="button" data-mentor-open>定位文件</button>
        <button type="button" data-mentor-hint>查看提示</button>
        <button type="button" data-mentor-verify class="primary-button">检查代码</button>
      </div>
      <div class="mentor-course-actions">
        <button type="button" data-mentor-back>上一步</button>
        <button type="button" data-mentor-pause>暂停</button>
        <button type="button" data-mentor-next class="primary-button" disabled>下一步 →</button>
      </div>
    </div>
  `;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '机器人项目教学');
  document.body.append(panel);

  const get = <T extends HTMLElement>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error('Missing mentor control: ' + selector);
    return element;
  };
  const progress = get<HTMLElement>('[data-mentor-progress]');
  const meter = get<HTMLProgressElement>('[data-mentor-meter]');
  const title = get<HTMLElement>('[data-mentor-title]');
  const objective = get<HTMLElement>('[data-mentor-objective]');
  const message = get<HTMLElement>('[data-mentor-message]');
  const explanation = get<HTMLElement>('[data-mentor-explanation]');
  const instruction = get<HTMLElement>('[data-mentor-instruction]');
  const checks = get<HTMLElement>('[data-mentor-checks]');
  const back = get<HTMLButtonElement>('[data-mentor-back]');
  const next = get<HTMLButtonElement>('[data-mentor-next]');
  const pause = get<HTMLButtonElement>('[data-mentor-pause]');
  const verify = get<HTMLButtonElement>('[data-mentor-verify]');
  const open = get<HTMLButtonElement>('[data-mentor-open]');
  const hint = get<HTMLButtonElement>('[data-mentor-hint]');
  const close = get<HTMLButtonElement>('[data-mentor-close]');

  let step = 0;
  let passed = false;
  let paused = false;
  let checking = false;
  let currentRoot = '';
  let visible = false;
  let animationSequence = 0;
  let positionFrame = 0;
  let lastPosition = '';

  function positionNearRobot(): void {
    if (!visible) return;
    const robot = document.getElementById('tutor-character');
    const stage = document.getElementById('editor-stage');
    if (!stage) return;

    const stageRect = stage.getBoundingClientRect();
    const robotRect = robot?.getBoundingClientRect();
    const robotVisible = Boolean(
      robot && !robot.classList.contains('offscreen') &&
      robotRect && robotRect.width > 0 && robotRect.height > 0 &&
      robotRect.right >= stageRect.left && robotRect.left <= stageRect.right &&
      robotRect.bottom >= stageRect.top && robotRect.top <= stageRect.bottom,
    );
    const padding = 12;
    const gap = 14;
    const width = Math.min(380, Math.max(260, window.innerWidth - padding * 2));
    const height = Math.min(panel.offsetHeight, window.innerHeight - padding * 2);
    const boundsLeft = Math.max(padding, stageRect.left + padding);
    const boundsRight = Math.min(window.innerWidth - padding, stageRect.right - padding);
    const boundsTop = Math.max(padding, stageRect.top + padding);
    const boundsBottom = Math.min(window.innerHeight - padding, stageRect.bottom - padding);
    const maxX = Math.max(boundsLeft, boundsRight - width);
    const maxY = Math.max(boundsTop, boundsBottom - height);
    let x: number;
    let y: number;
    let side = 'right';

    if (robotVisible && robotRect) {
      const rightX = robotRect.right + gap;
      const leftX = robotRect.left - width - gap;
      const rightFits = rightX + width <= boundsRight;
      const leftFits = leftX >= boundsLeft;
      if (rightFits || (!leftFits && boundsRight - robotRect.right >= robotRect.left - boundsLeft)) {
        x = rightX;
      } else {
        x = leftX;
        side = 'left';
      }
      y = robotRect.top + robotRect.height / 2 - Math.min(height, 440) * .38;
    } else {
      x = stageRect.left + Math.max(0, (stageRect.width - width) / 2);
      y = stageRect.top + 30;
      side = 'floating';
    }

    x = Math.min(maxX, Math.max(boundsLeft, x));
    y = Math.min(maxY, Math.max(boundsTop, y));
    const next = Math.round(x) + ',' + Math.round(y) + ',' + side;
    if (lastPosition !== next) {
      lastPosition = next;
      panel.style.left = Math.round(x) + 'px';
      panel.style.top = Math.round(y) + 'px';
      panel.dataset.side = side;
    }
  }

  function trackPosition(): void {
    if (!visible) { positionFrame = 0; return; }
    positionNearRobot();
    positionFrame = window.requestAnimationFrame(trackPosition);
  }

  function startTracking(): void {
    if (!positionFrame) positionFrame = window.requestAnimationFrame(trackPosition);
  }

  async function animateStep(speech?: string): Promise<void> {
    const sequence = ++animationSequence;
    if (!visible || paused) return;
    const lesson = reactTodoLessons[step]!;
    const message = speech ?? ('第 ' + (step + 1) + ' 步：' + lesson.title + '。' + lesson.objective);
    try {
      const snapshot = await syncProject();
      if (sequence !== animationSequence || !visible || paused) return;
      if (!snapshot || !snapshot.files.includes(lesson.file)) {
        const hintMessage = !snapshot ? '先按照教学面板的命令创建项目。' : '请先创建 ' + lesson.file + '。';
        const text = message + hintMessage;
        status('🤖 ' + hintMessage);
        panel.classList.remove('mentor-animate');
        void panel.offsetWidth;
        panel.classList.add('mentor-animate');
        return;
      }
      const source = await window.tutorIde.readProjectFile(lesson.file);
      if (sequence !== animationSequence || !visible || paused) return;
      robotMove(lesson.file, focusLine(lesson.id, source.content), message);
    } catch {
      // Explain in the panel if a file is unavailable; never block editing.
    }
  }

  function key(root: string): string { return STORAGE_KEY + ':' + root; }
  function persist(): void {
    if (currentRoot) {
      try { localStorage.setItem(key(currentRoot), JSON.stringify({ step, passed, paused })); }
      catch { /* storage may be unavailable */ }
    }
  }

  async function syncProject(): Promise<Snapshot | null> {
    const snapshot = await (window.tutorIde as Api).restoreProject();
    const root = snapshot?.rootPath ?? '';
    if (root !== currentRoot) {
      currentRoot = root;
      step = 0; passed = false; paused = false;
      if (root) {
        try {
          const saved = JSON.parse(localStorage.getItem(key(root)) ?? 'null') as
            { step?: number; passed?: boolean; paused?: boolean } | null;
          if (saved && Number.isInteger(saved.step) && saved.step! >= 0 && saved.step! < reactTodoLessons.length) {
            step = saved.step!; passed = false; paused = Boolean(saved.paused);
            // A previously passed step must always be re-verified after reopening a project.
          }
        } catch { /* ignore invalid saved state */ }
      }
    }
    return snapshot;
  }

  function render(): void {
    const lesson = reactTodoLessons[step]!;
    progress.textContent = '第 ' + (step + 1) + ' / ' + reactTodoLessons.length + ' 步';
    meter.max = reactTodoLessons.length;
    meter.value = step + Number(passed);
    title.textContent = lesson.title;
    objective.textContent = lesson.objective;
    explanation.textContent = lesson.explanation;
    instruction.textContent = lesson.instruction;
    checks.replaceChildren();
    lesson.checks.forEach((check) => {
      const row = document.createElement('div');
      row.textContent = '○ ' + check.label;
      checks.append(row);
    });
    back.disabled = step === 0 || checking;
    next.disabled = !passed || paused || checking || step === reactTodoLessons.length - 1;
    verify.disabled = paused || checking;
    open.disabled = !currentRoot;
    pause.textContent = paused ? '继续课程' : '暂停';
    message.textContent = paused ? '课程已暂停' : passed ? '✓ 本步验证通过，可以进入下一步' :
      currentRoot ? '请完成任务并保存文件，然后点击检查代码。' :
      '首先在终端创建项目，再点击顶部「打开项目」选择项目文件夹。';
  }

  async function toggle(show: boolean): Promise<void> {
    visible = show;
    panel.hidden = !visible;
    button.dataset.active = String(show);
    workspace!.dataset.mentorOpen = String(show);
    document.documentElement.classList.toggle('mentor-popover-visible', show);
    button.setAttribute('aria-expanded', String(show));
    if (show) startTracking();
    else { window.cancelAnimationFrame(positionFrame); positionFrame = 0; lastPosition = ''; }
    if (show) {
      try { await syncProject(); }
      catch { currentRoot = ''; }
      render();
      void animateStep();
    } else {
      animationSequence++;
    }
  }

  button.setAttribute('aria-controls', 'mentor-course-panel');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => { void toggle(!visible); });
  close.addEventListener('click', () => { void toggle(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && visible) { event.stopPropagation(); void toggle(false); }
  });
  // Clicking the animated tutor opens the course selector.
  const robot = document.getElementById('tutor-character');
  robot?.addEventListener('click', (event) => {
    // Keyboard-generated clicks have detail=0; pointer clicks are handled at capture phase.
    if (event instanceof MouseEvent && event.detail !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle(!visible);
  }, true);
  robot?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void toggle(true);
    }
  });
  // The animation layer deliberately allows mouse events through to Monaco.
  // Capture clicks based on the robot's visible rectangle so a transparent
  // tutor surface (or an overlapping speech bubble) cannot swallow the action.
  document.addEventListener('pointerdown', (event) => {
    if (!robot || event.button !== 0 || robot.classList.contains('offscreen')) return;
    const bounds = robot.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    if (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    ) return;
    const stage = document.getElementById('editor-stage');
    if (!stage) return;
    const stageBounds = stage.getBoundingClientRect();
    if (
      event.clientX < stageBounds.left || event.clientX > stageBounds.right ||
      event.clientY < stageBounds.top || event.clientY > stageBounds.bottom
    ) return;
    // Do not steal interactions from an open teaching card or other dialogs.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit?.closest('#mentor-course-panel, .modal-backdrop, .settings-dialog')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle(!visible);
  }, true);

  get<HTMLSelectElement>('#mentor-course-select').addEventListener('change', () => {
    step = 0; passed = false; persist(); render();
  });
  hint.addEventListener('click', () => {
    const lesson = reactTodoLessons[step]!;
    message.textContent = lesson.hint;
    void animateStep('提示：' + lesson.hint);
  });
  pause.addEventListener('click', () => {
    paused = !paused; persist(); render();
    if (paused) animationSequence++;
    else void animateStep('我们继续学习：' + reactTodoLessons[step]!.title);
  });

  back.addEventListener('click', () => {
    if (step <= 0 || checking) return;
    step--; passed = false; persist(); render();
    void animateStep();
  });
  next.addEventListener('click', () => {
    if (!passed || paused || checking || step >= reactTodoLessons.length - 1) return;
    step++; passed = false; persist(); render();
    void animateStep();
  });
  open.addEventListener('click', () => {
    if (!currentRoot) return;
    void animateStep('请看这里：' + reactTodoLessons[step]!.explanation);
  });

  verify.addEventListener('click', async () => {
    if (checking || paused) return;
    checking = true; passed = false; render();
    try {
      const snapshot = await syncProject();
      const lesson = reactTodoLessons[step]!;
      if (!snapshot) {
        message.textContent = '还没有真实项目。先创建并打开 React 项目。';
        return;
      }
      if (!snapshot.files.includes(lesson.file)) {
        message.textContent = '没有找到 ' + lesson.file + '。请检查是否打开了正确项目。';
        return;
      }
      if (document.querySelector<HTMLElement>('#editor-tab-dot')?.dataset.dirty === 'true') {
        message.textContent = '请先 Ctrl+S 保存正在编辑的文件，再检查。';
        return;
      }
      const result = await window.tutorIde.readProjectFile(lesson.file);
      const failed = lesson.checks.filter((check) => !check.test(result.content));
      checks.replaceChildren();
      lesson.checks.forEach((check) => {
        const row = document.createElement('div');
        const ok = !failed.includes(check);
        row.textContent = (ok ? '✓ ' : '✗ ') + check.label;
        row.dataset.passed = String(ok);
        checks.append(row);
      });
      passed = failed.length === 0;
      message.textContent = passed ? '✓ 本步验证通过！' :
        '有 ' + failed.length + ' 项尚未通过，请查看上方检查结果和提示。';
      status(passed ? '🤖 课程步骤验证通过' : '🤖 课程尚有未完成项');
      void animateStep(passed
        ? '做得好！这一关已通过。你可以点击下一步。'
        : '这里还有需要完成的内容：' + failed.map((check) => check.label).join('、') + '。点击查看提示，我会继续引导你。');
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : '检查失败';
    } finally {
      checking = false; persist();
      // Keep individual check results visible instead of clearing them with render().
      next.disabled = !passed || paused || step === reactTodoLessons.length - 1;
      verify.disabled = paused;
      back.disabled = step === 0;
      meter.value = step + Number(passed);
    }
  });

  // Saved code can be changed after a successful check: invalidate before advancing.
  window.tutorIde.onProjectFileChanged?.((change) => {
    if (change.path === reactTodoLessons[step]?.file && passed) {
      passed = false; persist();
      if (visible) render();
    }
  });
  document.querySelector('#editor-tab-dot') &&
    new MutationObserver(() => {
      if (passed && document.querySelector<HTMLElement>('#editor-tab-dot')?.dataset.dirty === 'true' &&
          document.getElementById('active-file')?.textContent?.trim() === reactTodoLessons[step]?.file) {
        passed = false; persist(); if (visible) render();
      }
    }).observe(document.querySelector('#editor-tab-dot')!, { attributes: true, attributeFilter: ['data-dirty'] });

  window.addEventListener('android-project-snapshot', () => {
    void syncProject().then(() => { if (visible) render(); });
  });
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
} else bootstrap();
