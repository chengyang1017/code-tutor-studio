import type { EditorController } from '../editor/editor_controller';
import { monaco } from '../editor/monaco_setup';
import './inline_copilot_tutor.css';

type Step = {
  file: string;
  title: string;
  instruction: string;
  explanation: string;
  example: string;
  anchor?: string;
  line?: number;
};
type Verify = { passed: boolean; feedback: string };
type Project = { rootPath: string; files: string[] };
type TutorApi = {
  restoreProject: () => Promise<Project | null>;
  readProjectFile: (path: string) => Promise<{ content: string }>;
  handsonStep?: (input: unknown) => Promise<unknown>;
};

function isStep(value: unknown): value is Step {
  return typeof value === 'object' && value !== null && 'file' in value
    && typeof value.file === 'string';
}
function isVerify(value: unknown): value is Verify {
  return typeof value === 'object' && value !== null && 'passed' in value
    && typeof value.passed === 'boolean';
}

export function installInlineCopilotTutor(controller: EditorController): void {
  if (document.getElementById('inline-copilot-launch')) return;
  const bar = document.querySelector<HTMLElement>('.commandbar');
  const api = window.tutorIde as TutorApi;
  if (!bar || !api?.restoreProject) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'inline-copilot-launch';
  button.textContent = '✦ 手把手';
  button.title = '在代码中直接指导，不使用教学弹窗';
  button.className = 'inline-copilot-launch';
  const holder = document.createElement('div');
  holder.className = 'command-group';
  holder.append(button);
  bar.append(holder);

  const editor = controller.editor;
  const node = document.createElement('section');
  node.className = 'inline-copilot-widget';
  node.innerHTML = `
    <div class="inline-copilot-top"><strong>✦ 手把手</strong><button type="button" data-x aria-label="关闭">×</button></div>
    <form data-goal-form class="inline-copilot-form">
      <input data-goal placeholder="想亲手写什么功能？如：登录系统" aria-label="开发目标" maxlength="2000" />
      <button type="submit" data-start>开始</button>
    </form>
    <div data-step hidden>
      <div data-heading class="inline-copilot-heading"></div>
      <div data-task class="inline-copilot-task"></div>
      <div data-location class="inline-copilot-location"></div>
      <div class="inline-copilot-actions">
        <button type="button" data-hint>提示</button>
        <button type="button" data-answer>参考答案</button>
        <button type="button" data-check>检查</button>
        <button type="button" data-next hidden>下一步</button>
      </div>
      <div data-help class="inline-copilot-help" hidden></div>
    </div>
    <div data-status role="status" aria-live="polite" class="inline-copilot-status"></div>
  `;
  const query = <T extends HTMLElement>(selector: string): T => node.querySelector<T>(selector)!;
  // Keep mouse events inside the teaching card from being handled as editor clicks.
  node.addEventListener('pointerdown', (event) => event.stopPropagation());
  node.addEventListener('mousedown', (event) => event.stopPropagation());
  node.addEventListener('click', (event) => event.stopPropagation());
  const goal = query<HTMLInputElement>('[data-goal]');
  const form = query<HTMLFormElement>('[data-goal-form]');
  const stepBox = query<HTMLElement>('[data-step]');
  const heading = query<HTMLElement>('[data-heading]');
  const task = query<HTMLElement>('[data-task]');
  const location = query<HTMLElement>('[data-location]');
  const help = query<HTMLElement>('[data-help]');
  const status = query<HTMLElement>('[data-status]');
  const next = query<HTMLButtonElement>('[data-next]');
  const check = query<HTMLButtonElement>('[data-check]');
  const answer = query<HTMLButtonElement>('[data-answer]');
  const hint = query<HTMLButtonElement>('[data-hint]');
  const start = query<HTMLButtonElement>('[data-start]');
  const widget = {
    getId: () => 'inline-copilot-tutor-widget',
    getDomNode: () => node,
    getPosition: (): monaco.editor.IContentWidgetPosition | null => visible
      ? { position: anchorPosition, preference: [monaco.editor.ContentWidgetPositionPreference.BELOW, monaco.editor.ContentWidgetPositionPreference.ABOVE] }
      : null,
    allowEditorOverflow: true,
    suppressMouseDown: false,
  };
  let visible = false;
  let busy = false;
  let current: Step | null = null;
  let history: Step[] = [];
  let root = '';
  let anchorPosition = new monaco.Position(1, 1);
  let pendingSuggestion = '';
  let showHint = false;
  editor.addContentWidget(widget);
  // Drag the whole Monaco teaching card by its title bar.
  const handle = query<HTMLElement>('.inline-copilot-top');
  let offsetX = 0;
  let offsetY = 0;
  let dragStart: { x: number; y: number; left: number; top: number; pointerId: number } | null = null;
  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button,input'))) return;
    event.preventDefault();
    event.stopPropagation();
    dragStart = { x: event.clientX, y: event.clientY, left: offsetX, top: offsetY, pointerId: event.pointerId };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event: PointerEvent) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    const rect = node.getBoundingClientRect();
    const desiredX = dragStart.left + deltaX;
    const desiredY = dragStart.top + deltaY;
    offsetX = Math.round(Math.max(12 - rect.left + offsetX, Math.min(window.innerWidth - 12 - rect.right + offsetX, desiredX)));
    offsetY = Math.round(Math.max(12 - rect.top + offsetY, Math.min(window.innerHeight - 12 - rect.bottom + offsetY, desiredY)));
    node.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  });
  function endDrag(event: PointerEvent): void {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    dragStart = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);


  const inlineProvider = monaco.languages.registerInlineCompletionsProvider(
    ['typescript','javascript','typescriptreact','javascriptreact','dart','json','css','html','python','plaintext'],
    {
      provideInlineCompletions(model, position) {
        if (!visible || !current || !pendingSuggestion || controller.path !== current.file || editor.getModel() !== model) {
          return { items: [] };
        }
        const text = pendingSuggestion;
        return { items: [{
          insertText: text,
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        }] };
      },
      disposeInlineCompletions(_completions, _reason) { /* no resources to release */ },
    },
  );
  void inlineProvider;

  function position(line?: number): void {
    const model = editor.getModel();
    if (!model) return;
    const target = Math.max(1, Math.min(model.getLineCount(), line ?? editor.getPosition()?.lineNumber ?? 1));
    anchorPosition = new monaco.Position(target, 1);
    editor.revealLineInCenter(target);
    editor.layoutContentWidget(widget);
  }
  function open(): void {
    visible = true;
    const panel = document.getElementById('mentor-course-panel');
    if (panel) panel.hidden = true;
    node.classList.remove('inline-copilot-hidden');
    position();
    goal.focus();
  }
  function close(): void {
    visible = false;
    pendingSuggestion = '';
    node.classList.add('inline-copilot-hidden');
    editor.layoutContentWidget(widget);
    editor.focus();
  }
  button.addEventListener('click', () => visible ? close() : open());
  query<HTMLButtonElement>('[data-x]').addEventListener('click', close);

  async function request(mode: 'next' | 'verify'): Promise<unknown> {
    if (busy || !goal.value.trim()) return null;
    if (!api.handsonStep) { status.textContent = '没有找到手把手教学接口。请先安装教学功能。'; return null; }
    busy = true;
    start.disabled = true;
    check.disabled = true;
    next.disabled = true;
    status.textContent = mode === 'verify' ? '正在检查你的代码…' : '正在查看当前项目…';
    try {
      const project = await api.restoreProject();
      if (!project) throw new Error('请先打开本地项目。');
      if (root !== project.rootPath) {
        root = project.rootPath;
        history = [];
        current = null;
      }
      return await api.handsonStep({mode, goal:goal.value.trim(), history, previous:current});
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      return null;
    } finally {
      busy = false;
      start.disabled = false;
      check.disabled = false;
      next.disabled = false;
    }
  }
  async function navigateTo(step: Step): Promise<void> {
    pendingSuggestion = '';
    const file = step.file;
    if (!file || file.startsWith('/') || file.includes('..') || /^[A-Z]:/i.test(file)) return;
    const project = await api.restoreProject();
    if (!project?.files.includes(file)) {
      status.textContent = `请先手动创建 ${file}，然后重新定位。`;
      location.textContent = `需新建：${file}`;
      return;
    }
    // The main editor owns file opening, dirty checking, and Monaco models.
    window.dispatchEvent(new CustomEvent('code-tutor-handson-guide', {
      detail:{ file, anchor: step.anchor || '', line: step.line || 1, task:step.title },
    }));
    let tries = 0;
    const follow = window.setInterval(() => {
      tries++;
      if (!visible || current !== step || tries > 24) { clearInterval(follow); return; }
      if (controller.path !== file) return;
      const model = editor.getModel();
      if (!model) return;
      const anchor = step.anchor?.trim();
      const offset = anchor ? model.getValue().indexOf(anchor) : -1;
      const line = offset >= 0
        ? model.getPositionAt(offset).lineNumber
        : Number.isFinite(step.line) ? Math.floor(step.line!) : 1;
      position(line);
      location.textContent = `${file}:${anchor && offset >= 0 ? line + '（已找到）' : line + '（建议位置）'}`;
      clearInterval(follow);
    }, 100);
  }
  async function showNext(): Promise<void> {
    const output = await request('next');
    if (!isStep(output)) return;
    current = output;
    history.push(output);
    heading.textContent = output.title || '当前任务';
    task.textContent = output.instruction || '请在当前文件完成这一小步。';
    location.textContent = output.file;
    stepBox.hidden = false;
    help.hidden = true;
    showHint = false;
    next.hidden = true;
    pendingSuggestion = '';
    status.textContent = '你先写。需要帮助再点「提示」或「参考答案」。';
    await navigateTo(output);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    history = [];
    current = null;
    void showNext();
  });
  hint.addEventListener('click', () => {
    if (!current) return;
    showHint = !showHint;
    help.hidden = !showHint;
    help.textContent = current.explanation || '先找到对应函数，完成任务后点击检查。';
    editor.layoutContentWidget(widget);
  });
  // Always display the answer inside the teaching card, not solely as ghost text.
  // INLINE_PLACEMENT_V2 - explicit and verified placement for each reference answer.
  answer.addEventListener('click', async () => {
    if (!current || busy) return;
    answer.disabled = true;
    help.hidden = false;
    help.textContent = '正在核对代码应该写在哪个位置…';
    editor.layoutContentWidget(widget);
    try {
      if (!api.handsonStep) throw new Error('没有找到教学接口。');
      const response: unknown = await api.handsonStep({
        mode: 'reference', goal: goal.value.trim(), history, previous: current,
      });
      if (!response || typeof response !== 'object' || !('example' in response) || typeof response.example !== 'string') {
        throw new Error('AI 没有返回有效的参考答案。');
      }
      const snippet = response.example.trim();
      if (!snippet) throw new Error('这一步没有参考代码，请重试。');
      const place = 'placement' in response && response.placement && typeof response.placement === 'object'
        ? response.placement as { action?:string; line?:number; anchor?:string; note?:string; verified?:boolean; file?:string }
        : null;
      help.replaceChildren();
      const where = document.createElement('div');
      where.className = 'inline-copilot-answer-where';
      const file = place?.file || current.file;
      let action = '具体插入位置无法确认，请先核对原文件';
      if (place?.verified && typeof place.line === 'number') {
        if (place.action === 'replace') action = '替换第 ' + place.line + ' 行开始的原代码';
        else if (place.action === 'before') action = '在第 ' + place.line + ' 行之前插入';
        else if (place.action === 'after') action = '在第 ' + place.line + ' 行之后插入';
      } else if (place?.action === 'new_file') action = '新文件：需要先创建此文件';
      where.textContent = file + ' · ' + action;
      help.append(where);
      if (place?.note) {
        const note = document.createElement('div');
        note.className = 'inline-copilot-answer-note';
        note.textContent = place.note;
        help.append(note);
      }
      if (place?.verified && typeof place.line === 'number') {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.textContent = '定位到这里';
        jump.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('code-tutor-handson-guide', {
            detail: {file, line:place.line, anchor: place.anchor || '', task:current?.title || ''},
          }));
          position(place.line);
        });
        help.append(jump);
        window.dispatchEvent(new CustomEvent('code-tutor-handson-guide', {
          detail: {file, line:place.line, anchor:place.anchor || '', task: current.title},
        }));
      }
      const pre = document.createElement('pre');
      pre.className = 'inline-copilot-answer-code';
      const code = document.createElement('code');
      code.textContent = snippet;
      pre.append(code);
      help.append(pre);
      pendingSuggestion = place?.verified ? snippet : '';
      status.textContent = place?.verified ? '已定位参考答案的写入位置。请自己动手编写。' : '已显示参考答案，但无法核实准确位置，尚未自动插入。';
      editor.layoutContentWidget(widget);
    } catch (error) {
      help.textContent = error instanceof Error ? error.message : String(error);
      status.textContent = '参考答案获取失败，未修改任何代码。';
    } finally {
      answer.disabled = false;
      editor.layoutContentWidget(widget);
    }
  });
  check.addEventListener('click', async () => {
    if (!current) return;
    pendingSuggestion = '';
    const result = await request('verify');
    if (!isVerify(result)) return;
    status.textContent = result.feedback || (result.passed ? '完成，可以进入下一步。' : '还需要修改。');
    next.hidden = !result.passed;
    editor.layoutContentWidget(widget);
  });
  next.addEventListener('click', () => void showNext());
  window.addEventListener('code-tutor-handson-guide', event => {
    const data = (event as CustomEvent<{file?:string;line?:number}>).detail;
    if (visible && current && data?.file === current.file) position(data.line);
  });
}
