import type { EditorController } from '../editor/editor_controller';
import { monaco } from '../editor/monaco_setup';
import './inline_copilot_tutor.css';
import './robot_dialog_tutor.css';

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
type Api = {
  restoreProject: () => Promise<Project | null>;
  handsonStep?: (input: unknown) => Promise<unknown>;
};
type Placement = {
  action?: string;
  line?: number;
  anchor?: string;
  file?: string;
  verified?: boolean;
};
type Ghost = {
  model: monaco.editor.ITextModel;
  line: number;
  column: number;
  text: string;
  kind: 'insert' | 'replace' | 'preview';
};

function isStep(value: unknown): value is Step {
  return !!value && typeof value === 'object' &&
    'file' in value && typeof value.file === 'string';
}
function isVerify(value: unknown): value is Verify {
  return !!value && typeof value === 'object' &&
    'passed' in value && typeof value.passed === 'boolean';
}

export function installInlineCopilotTutor(controller: EditorController): void {
  if (/Android/i.test(navigator.userAgent)) return; // Electron desktop only
  if (document.getElementById('inline-copilot-launch')) return;
  const bar = document.querySelector<HTMLElement>('.commandbar');
  const api = window.tutorIde as Api;
  if (!bar || !api?.restoreProject) return;

  const launch = document.createElement('button');
  launch.id = 'inline-copilot-launch';
  launch.className = 'inline-copilot-launch';
  launch.type = 'button';
  launch.textContent = '🤖 手把手';
  const holder = document.createElement('div');
  holder.className = 'command-group';
  holder.append(launch);
  bar.append(holder);

  const editor = controller.editor;
  const box = document.createElement('section');
  box.className = 'inline-copilot-widget robot-dialog-tutor inline-copilot-hidden';
  box.setAttribute('aria-label', '机器人手把手教学');
  box.innerHTML = `
    <header class="robot-dialog-head"><span>🤖 机器人</span><button data-close type="button" aria-label="关闭">×</button></header>
    <div data-bubble class="robot-dialog-bubble" role="status" aria-live="polite">你想开发什么？告诉我，我们一步一步来。</div>
    <div data-choices class="robot-dialog-choices" hidden>
      <button data-yes type="button">我会写</button>
      <button data-no type="button">不会写</button>
    </div>
    <form data-form class="robot-dialog-form">
      <input data-input maxlength="2000" placeholder="输入你想开发的功能…" aria-label="回复机器人" />
      <button data-send type="submit" aria-label="发送">➤</button>
    </form>
    <div data-footer class="robot-dialog-footer" hidden>
      <button data-restore type="button" hidden>↻ 重显提示</button>
      <button data-check type="button">检查代码</button>
      <button data-next type="button" hidden>下一步</button>
    </div>
  `;
  const el = <T extends HTMLElement>(selector: string) => box.querySelector<T>(selector)!;
  const bubble = el<HTMLElement>('[data-bubble]');
  const form = el<HTMLFormElement>('[data-form]');
  const input = el<HTMLInputElement>('[data-input]');
  const choices = el<HTMLElement>('[data-choices]');
  const yes = el<HTMLButtonElement>('[data-yes]');
  const no = el<HTMLButtonElement>('[data-no]');
  const restore = el<HTMLButtonElement>('[data-restore]');
  const check = el<HTMLButtonElement>('[data-check]');
  const next = el<HTMLButtonElement>('[data-next]');
  const footer = el<HTMLElement>('[data-footer]');
  const send = el<HTMLButtonElement>('[data-send]');
  let visible = false;
  let busy = false;
  let goal = '';
  let current: Step | null = null;
  let history: Step[] = [];
  let projectRoot = '';
  let ghost: Ghost | null = null;
  let suppliedCount = 0;

  function say(text: string): void { bubble.textContent = text; }
  function setBusy(value: boolean): void {
    busy = value;
    input.disabled = value;
    send.disabled = value;
    yes.disabled = value;
    no.disabled = value;
    restore.disabled = value;
    check.disabled = value;
    next.disabled = value;
  }
  function clearGhost(): void {
    ghost = null;
    teachingGhostDecorations.clear();
    restore.hidden = true;
    editor.trigger('robot-dialog-tutor', 'editor.action.inlineSuggest.hide', {});
  }

  // ROBOT_GHOST_RESTORE_V1
  // Reuse the existing completion. Never request AI again just to redisplay.
  function restoreGhost(): void {
    if (!ghost || !current || controller.path !== current.file ||
        editor.getModel() !== ghost.model) {
      say('当前没有可恢复的参考提示，请先打开任务文件。');
      return;
    }
    // Do not steal focus or overwrite the cursor position.
    refreshTeachingGhost();
    editor.revealLineInCenter(Math.max(1, Math.min(ghost.line, ghost.model.getLineCount())));
    say('灰色参考已重新定位到代码中。可以继续输入，不必移动光标到提示处。');
  }

  restore.addEventListener('click', restoreGhost);
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyG,
    restoreGhost,
  );
  // ROBOT_CHOICE_STAGE_V1
  let decisionMade = false;
  function ask(): void {
    // Each new step asks the learner to choose, even after earlier choices.
    decisionMade = false;
    choices.hidden = false;
    footer.hidden = true;
    next.hidden = true;
    input.placeholder = '也可以直接输入回复…';
  }
  const overlay: monaco.editor.IOverlayWidget = {
    getId: () => 'inline-copilot-tutor-widget',
    getDomNode: () => box,
    getPosition: () => ({
      preference: monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER,
    }),
  };
  editor.addOverlayWidget(overlay);

  // Use Monaco's native inline suggestion channel. This never writes a file
  // until the learner intentionally accepts a completion (Tab).
  editor.updateOptions({inlineSuggest: { enabled: true, keepOnBlur: true, mode: 'subword'}});
  const provider = monaco.languages.registerInlineCompletionsProvider(
    ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'dart',
      'json', 'css', 'html', 'python', 'plaintext', 'java', 'kotlin', 'csharp'],
    {
      provideInlineCompletions(model, position) {
        const active = ghost;
        if (!visible || !active || model !== active.model ||
            model !== editor.getModel() || !current ||
            controller.path !== current.file ||
            position.lineNumber < active.line) return {items: []};

        if (active.kind === 'preview') return { items: [] };
        if (active.kind === 'replace') {
          if (position.lineNumber !== active.line || position.column !== 1 ||
              model.getLineContent(active.line).trim() === active.text.trim()) {
            return {items: []};
          }
          // Real Monaco inline *replacement*, limited to a single existing line.
          suppliedCount++;
          return {items: [{
            insertText: active.text,
            range: new monaco.Range(active.line, 1, active.line, model.getLineMaxColumn(active.line)),
          }]};
        }

        const start = model.getOffsetAt({lineNumber: active.line, column: active.column});
        const end = model.getOffsetAt(position);
        if (end < start) return {items: []};
        const alreadyTyped = model.getValue().slice(start, end);
        if (!active.text.startsWith(alreadyTyped)) return {items: []};
        const remaining = active.text.slice(alreadyTyped.length);
        if (!remaining) return {items: []};
        suppliedCount++;
        return {items: [{
          insertText: remaining,
          range: new monaco.Range(position.lineNumber, position.column,
            position.lineNumber, position.column),
        }]};
      },
      disposeInlineCompletions() {},
    },
  );
  void provider;

  // ROBOT_GHOST_STATE_REPAIR_V1
  // Persistent Monaco injected text is independent from caret and focus.
  // Keep it at the end of an existing line, never overprint source code.
  const teachingGhostDecorations = editor.createDecorationsCollection();
  
  // ROBOT_PINNED_GHOST_VISIBILITY_V3
  // Monaco content widget: presentation only, no edits, no focus, no click interception.
  // The text is owned by ghost state, not Monaco's temporary inline completion state.
  const pinnedReference = document.createElement('pre');
  pinnedReference.setAttribute('aria-label', 'Persistent teaching code reference');
  pinnedReference.style.cssText = [
    'margin:0', 'padding:0', 'border:0', 'background:transparent',
    'font:12px/19px Consolas,monospace', 'color:#a4b8d7',
    'opacity:.84', 'white-space:pre', 'pointer-events:none',
    'user-select:none', 'max-width:460px', 'overflow:hidden',
    'text-shadow:0 1px 1px #121926'
  ].join(';');
  let pinnedPosition: monaco.Position | null = null;
  const pinnedWidget: monaco.editor.IContentWidget = {
    getId: () => 'robot-pinned-teaching-reference-v3',
    getDomNode: () => pinnedReference,
    getPosition: () => pinnedPosition ? {
      position: pinnedPosition,
      preference: [
        monaco.editor.ContentWidgetPositionPreference.BELOW,
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
      ],
    } : null,
  };
  editor.addContentWidget(pinnedWidget);

  function refreshTeachingGhost(): void {
    teachingGhostDecorations.clear();
    pinnedPosition = null;
    pinnedReference.textContent = '';
    const active = ghost;
    const model = editor.getModel();
    if (!visible || !active || !current || !model || active.model !== model) {
      editor.layoutContentWidget(pinnedWidget);
      return;
    }
    // File switching is controlled by the editor model identity, not by
    // comparing an absolute controller path to a potentially relative task path.
    const line = Math.max(1, Math.min(model.getLineCount(), active.line));
    const column = Math.max(1, Math.min(model.getLineMaxColumn(line), active.column));
    const lines = active.text.replace(/\r\n?/g, '\n').split('\n');
    const nonEmpty = lines.filter(part => part.trim());
    if (!nonEmpty.length) { editor.layoutContentWidget(pinnedWidget); return; }
    const label = nonEmpty[0].trim().slice(0, 175);
    // Preserve the existing one-line ghost decoration as an inline cue.
    teachingGhostDecorations.set([{
      range: new monaco.Range(line, column, line, column),
      options: {
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        after: {content: '  ⇢ ' + label, inlineClassName: 'robot-persistent-ghost-inline'},
      },
    }]);
    // Also draw a small, cursor-independent multiline preview INSIDE Monaco.
    // It is transparent and cannot capture keyboard or mouse events.
    pinnedPosition = new monaco.Position(line, column);
    pinnedReference.textContent = nonEmpty.slice(0, 5).join('\n').slice(0, 580) +
      (nonEmpty.length > 5 ? '\n…' : '');
    pinnedReference.style.display = 'block';
    editor.layoutContentWidget(pinnedWidget);
  }

  editor.onDidChangeModelContent(() => refreshTeachingGhost());
  editor.onDidChangeModel(() => refreshTeachingGhost());

  // ROBOT_VISIBLE_FALLBACK_GHOST_V1
  // If AI returned source but an exact edit cannot be established, never
  // discard the answer entirely. Show one compact, non-accepting line in
  // Monaco at the *suggested* location, labeled as an unverified reference.
  function previewUnmatched(model: monaco.editor.ITextModel, file: string,
      suggested: string, targetLine: number, reason: string): void {
    const lines = suggested.replace(/\r\n?/g, '\n').split('\n');
    const existing = new Set(model.getValue().replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.trim()));
    const lineNumber = Math.max(1, Math.min(model.getLineCount(), targetLine));
    const nearby = model.getLineContent(lineNumber);
    const symbol = /(?:function|const|type|interface|class)\s+([A-Za-z_$][\w$]*)/.exec(nearby)?.[1];
    let candidate = '';
    if (symbol) {
      const position = lines.findIndex(line => new RegExp('\\b' + symbol + '\\b').test(line));
      if (position >= 0) {
        candidate = lines.slice(position + 1).find(line => line.trim() &&
          !existing.has(line.trim()) && line.trim() !== '{' && line.trim() !== '}') ?? '';
      }
    }
    if (!candidate) candidate = lines.find(line => line.trim() &&
      !existing.has(line.trim()) && line.trim() !== '{' && line.trim() !== '}') ?? '';
    if (!candidate) candidate = lines.find(line => line.trim()) ?? '';
    if (!candidate) {
      say('AI 没有返回可显示的参考代码。');
      return;
    }
    ghost = {model, line: lineNumber, column: model.getLineMaxColumn(lineNumber),
      text: candidate.trim().slice(0, 180), kind: 'preview'};
    refreshTeachingGhost();
    restore.hidden = false;
    footer.hidden = false;
    choices.hidden = true;
    editor.revealLineInCenter(lineNumber);
    say(`文件：${file}，参考位置：第 ${lineNumber} 行。\n${reason}\n灰色参考已显示在代码行末尾。由于尚未确认精确修改范围，暂不支持 Tab 自动替换，请对照原代码手动修改。`);
  }

  function normalizeLine(line: string): string { return line.trim(); }

  // Align the proposed code to ACTUAL existing lines. No code panels or
  // view zones: only a small, verifiable next edit is offered.
  function nextEdit(model: monaco.editor.ITextModel, suggested: string, near: number):
      { line: number; text: string; kind: 'insert' | 'replace'; reason: string } | null {
    const proposed = suggested.replace(/\r\n?/g, '\n').split('\n');
    const actual = model.getValue().replace(/\r\n?/g, '\n').split('\n');
    const equal = (a: string, b: string) => normalizeLine(a) === normalizeLine(b);
    if (!proposed.length || !proposed[0].trim()) return null;

    // Find an exact code anchor, preferring the line closest to AI's target.
    let anchor = -1;
    let closest = Infinity;
    for (let i = 0; i < actual.length; i++) {
      if (!equal(actual[i], proposed[0])) continue;
      const distance = Math.abs(i + 1 - near);
      if (distance < closest) { anchor = i; closest = distance; }
    }
    if (anchor < 0 || closest > 80) return null;

    let i = 0;
    let j = anchor;
    while (i < proposed.length && j < actual.length && equal(proposed[i], actual[j])) {
      i++; j++;
    }
    if (i >= proposed.length) return null; // Proposed code is already present.

    // Proposed lines appear before the next unchanged existing line.
    // Suggest an insertion (not a duplicate function) at that boundary.
    for (let k = i + 1; k < Math.min(proposed.length, i + 14); k++) {
      if (j < actual.length && equal(proposed[k], actual[j])) {
        const extra = proposed.slice(i, k).join(model.getEOL()) + model.getEOL();
        if (extra.trim()) return {line: j + 1, text: extra, kind: 'insert',
          reason: `在第 ${j + 1} 行之前新增 ${k - i} 行`};
      }
    }

    // Single-line substitution, where the next line is an exact anchor.
    if (j + 1 < actual.length && i + 1 < proposed.length &&
        equal(actual[j + 1], proposed[i + 1]) && proposed[i].trim()) {
      return {line: j + 1, text: proposed[i], kind: 'replace',
        reason: `替换第 ${j + 1} 行（仅这一行）`};
    }

    // If a matching block is followed by a genuinely new, complete declaration,
    // suggest only that declaration, never the whole generated answer.
    // Example: after an existing AuthUser type, add a missing StoredAuthPayload.
    const skip = (v: string) => !v.trim();
    let first = i;
    while (first < proposed.length && skip(proposed[first])) first++;
    if (first < proposed.length && j < actual.length &&
        /^(?:export\s+)?(?:type|interface|const|let|function|class)\s+[A-Za-z_$][\w$]*/.test(proposed[first].trim()) &&
        !actual.some(line => equal(line, proposed[first]))) {
      const block: string[] = [];
      let braces = 0;
      let sawBrace = false;
      for (let k = first; k < Math.min(proposed.length, first + 24); k++) {
        const entry = proposed[k];
        if (!entry.trim() && block.length === 0) continue;
        block.push(entry);
        braces += (entry.match(/\{/g) || []).length - (entry.match(/\}/g) || []).length;
        if (entry.includes('{')) sawBrace = true;
        if (sawBrace && braces === 0) break;
        if (!sawBrace && entry.trim().endsWith(';')) break;
      }
      if (block.length > 0 && block.length < 24 &&
          ((!sawBrace && block[block.length - 1].trim().endsWith(';')) ||
           (sawBrace && braces === 0))) {
        return {
          line: j + 1,
          text: block.join(model.getEOL()) + model.getEOL() + model.getEOL(),
          kind: 'insert',
          reason: `在第 ${j + 1} 行之前新增 ${block[0].trim().slice(0, 48)}`,
        };
      }
    }

    return null; // Never guess the boundaries of an existing function.
  }


  function open(): void {
    visible = true;
    const otherPanel = document.getElementById('mentor-course-panel');
    if (otherPanel) otherPanel.hidden = true;
    box.classList.remove('inline-copilot-hidden');
    editor.layoutOverlayWidget(overlay);
    input.focus();
  }
  function close(): void {
    visible = false;
    clearGhost();
    box.classList.add('inline-copilot-hidden');
    editor.layoutOverlayWidget(overlay);
    editor.focus();
  }
  launch.addEventListener('click', () => visible ? close() : open());
  el<HTMLButtonElement>('[data-close]').addEventListener('click', close);
  // Keep dragging/clicking the dialog from selecting text inside Monaco.
  box.addEventListener('pointerdown', e => e.stopPropagation());
  box.addEventListener('mousedown', e => e.stopPropagation());
  box.addEventListener('click', e => e.stopPropagation());

  async function request(mode: 'next' | 'verify' | 'reference'): Promise<unknown> {
    if (busy || !api.handsonStep) {
      if (!api.handsonStep) say('当前没有连接教学接口。');
      return null;
    }
    setBusy(true);
    try {
      const project = await api.restoreProject();
      if (!project) throw new Error('请先打开一个本地项目。');
      if (project.rootPath !== projectRoot) {
        projectRoot = project.rootPath;
        history = [];
        current = null;
        clearGhost();
      }
      return await api.handsonStep({mode, goal, previous: current, history});
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function navigate(step: Step): Promise<boolean> {
    const file = step.file;
    if (!file || file.startsWith('/') || file.includes('..') || /^[A-Z]:/i.test(file)) {
      say('AI 返回的文件路径不安全，请重新生成这一步。');
      return false;
    }
    const project = await api.restoreProject();
    if (!project?.files.includes(file)) {
      say(`这一步需要先创建文件：${file}\n请创建并打开它，再回复“不会写”或“会写”。`);
      return false;
    }
    window.dispatchEvent(new CustomEvent('code-tutor-handson-guide', {
      detail: {file, anchor: step.anchor || '', line: step.line || 1, task: step.title},
    }));
    for (let i = 0; i < 20 && visible && current === step; i++) {
      if (controller.path === file && editor.getModel()) {
        const model = editor.getModel()!;
        const offset = step.anchor ? model.getValue().indexOf(step.anchor) : -1;
        const wanted = offset >= 0 ? model.getPositionAt(offset).lineNumber : step.line || 1;
        editor.revealLineInCenter(Math.max(1, Math.min(model.getLineCount(), wanted)));
        return true;
      }
      await new Promise<void>(resolve => window.setTimeout(resolve, 100));
    }
    return false;
  }

  async function nextStep(): Promise<void> {
    if (!goal.trim()) { say('先告诉我你想开发什么功能。'); return; }
    clearGhost();
    decisionMade = false;
    choices.hidden = true;
    footer.hidden = true;
    say('我先看看项目，找出下一步…');
    const result = await request('next');
    if (!isStep(result)) return;
    current = result;
    history.push(result);
    await navigate(result);
    say(`第 ${history.length} 步：${result.title || '开始编写'}\n文件：${result.file}\n${result.instruction || ''}\n\n这一步你会写吗？`);
    ask();
  }

  async function showReference(): Promise<void> {
    if (!current || busy) return;
    const step = current;
    decisionMade = true;
    choices.hidden = true;
    input.placeholder = '输入问题或“写好了”…';
    say(`好的，我告诉你代码写在哪里。\n文件：${step.file}\n正在准备代码提示…`);
    const result = await request('reference');
    if (step !== current) return;
    if (!result || typeof result !== 'object' || !('example' in result) ||
        typeof result.example !== 'string' || !result.example.trim()) {
      say('这一步还没有生成参考代码。你可以再次回复“不会写”。');
      ask();
      return;
    }
    const place = 'placement' in result && result.placement &&
      typeof result.placement === 'object'
      ? result.placement as Placement : null;
    const file = place?.file || step.file;
    if (file !== step.file || controller.path !== file) {
      say(`请先打开 ${step.file}，再回复“不会写”。`);
      ask();
      return;
    }
    const model = editor.getModel();
    if (!model) {
      say('编辑器尚未打开文件，请先打开目标文件。');
      ask();
      return;
    }
    clearGhost();
    const reliable = !!place?.verified && Number.isInteger(place.line) &&
      place.line! >= 1 && place.line! <= model.getLineCount();
    const line = reliable ? place!.line! :
      Math.max(1, Math.min(model.getLineCount(), step.line || 1));
    const snippet = result.example.trim().replace(/\r\n?/g, '\n');
    if (!reliable) {
      previewUnmatched(model, file, snippet, line,
        'AI 尚未核实准确修改范围，因此这条提示仅供对照。');
      return;
    }
    const aligned = nextEdit(model, snippet, line);
    if (aligned) {
      if (aligned.kind === 'insert' && aligned.line > 1) {
        const previous = aligned.line - 1;
        ghost = {
          model, line: previous, column: model.getLineMaxColumn(previous),
          kind: 'insert',
          text: model.getEOL() + aligned.text.replace(/(?:\\r?\\n)+$/, ''),
        };
      } else {
        ghost = {
          model, line: aligned.line, column: 1,
          kind: aligned.kind, text: aligned.text,
        };
      }
      editor.revealLineInCenter(aligned.line);
      say(`文件：${file}\n${aligned.reason}\n灰色参考会固定在编辑器对应位置。\n可以跟着输入，或按 Tab 接受这一处修改。`);
    } else if (place.action === 'before' || place.action === 'after') {
      // Only insert a new block when it does not already match an existing
      // anchor; never replace a whole existing function in this fallback.
      const afterLine = place.action === 'after' ? line : line - 1;
      const safe = !snippet.split('\n').some(part =>
        part.trim().length > 10 && model.getValue().includes(part.trim()));
      if (!safe) {
        previewUnmatched(model, file, snippet, line, '参考代码与现有代码有重叠，以下仅供对照，不会自动插入重复函数。');
        return;
      }
      if (afterLine > 0) {
        // Monaco multiline ghosts are reliable when anchored at the END
        // of an existing line, not at column 1 of an occupied line.
        const before = model.getLineContent(afterLine);
        const braceCount = (before.match(/\{/g) || []).length -
          (before.match(/\}/g) || []).length;
        if (braceCount > 0 && /^\s*(?:export\s+)?(?:type|interface|function|const|class)\s/.test(snippet)) {
          previewUnmatched(model, file, snippet, line, '定位点可能位于现有代码块内部，参考内容仅供对照。');
          return;
        }
        ghost = {
          model, line: afterLine, column: model.getLineMaxColumn(afterLine),
          kind: 'insert',
          text: model.getEOL() + snippet.replace(/\n/g, model.getEOL()),
        };
      } else {
        ghost = {
          model, line: 1, column: 1, kind: 'insert',
          text: snippet.replace(/\n/g, model.getEOL()) + model.getEOL(),
        };
      }
      editor.revealLineInCenter(ghost.line);
      say(`文件：${file}\n${place.action === 'before' ? '在' : '紧接'}第 ${line} 行${place.action === 'before' ? '之前' : '之后'}新增代码。\n灰色参考将固定显示在编辑器中；可安全补全时支持 Tab。`);
    } else {
      previewUnmatched(model, file, snippet, line, '这段代码尚不能安全对应到具体替换范围。');
      return;
    }
    footer.hidden = false;
    choices.hidden = true;
    restore.hidden = false;
    editor.focus();
    suppliedCount = 0;
    refreshTeachingGhost();
    editor.trigger('robot-dialog-tutor', 'editor.action.inlineSuggest.trigger', {});
    // Trigger again after focus/cursor has settled; typing afterwards is
    // tracked through the same provider using the already-typed prefix.
    window.setTimeout(() => {
      if (visible && ghost && current === step) {
        refreshTeachingGhost();
    editor.trigger('robot-dialog-tutor', 'editor.action.inlineSuggest.trigger', {});
      }
    }, 120);

  }

  async function verify(): Promise<void> {
    if (!current || busy) return;
    say('我来检查你写的代码…');
    const result = await request('verify');
    if (!isVerify(result)) return;
    if (result.passed) {
      clearGhost();
      say(`${result.feedback || '写对了！'}\n\n要继续下一步吗？`);
      choices.hidden = true;
      footer.hidden = false;
      next.hidden = false;
    } else {
      say(`${result.feedback || '还有地方需要调整。'}\n\n需要我再次显示代码提示吗？`);
      ask();
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const reply = input.value.trim();
    if (!reply || busy) return;
    input.value = '';
    if (!goal) {
      goal = reply;
      history = [];
      current = null;
      void nextStep();
    } else if (/^(不会|不会写|不懂|不会啊|不会呢|不知道|给我提示|提示|no|help)$/i.test(reply)) {
      void showReference();
    } else if (/^(会|会写|我会|我会写|yes|自己写)$/i.test(reply)) {
      if (current) {
        decisionMade = true;
        input.placeholder = '输入问题或“写好了”…';
        say(`好的！就在 ${current.file} 里写。\n完成后点“检查代码”。需要参考时直接回复“不会写”。`);
        choices.hidden = true;
        footer.hidden = false;
        void navigate(current);
      }
    } else if (/^(检查|检查代码|写好了|完成了|好了)$/i.test(reply)) {
      void verify();
    } else if (/^(下一步|继续|继续下一步)$/i.test(reply)) {
      if (!next.hidden) void nextStep();
      else say('先完成并检查这一步，再继续。');
    } else {
      say('你可以继续提出问题，或者回复“写好了”让我检查代码。');
    }
  });
  yes.addEventListener('click', () => {
    if (!current) return;
    decisionMade = true;
    input.placeholder = '输入问题或“写好了”…';
    say(`很好！在 ${current.file} 里试着写。\n完成后点击“检查代码”。不会了随时回复我。`);
    choices.hidden = true;
    footer.hidden = false;
    void navigate(current);
  });
  no.addEventListener('click', () => { void showReference(); });
  check.addEventListener('click', () => { void verify(); });
  next.addEventListener('click', () => { void nextStep(); });
}
