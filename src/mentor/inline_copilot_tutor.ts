import type { EditorController } from '../editor/editor_controller';
import { monaco } from '../editor/monaco_setup';
import { planTeachingEdits, teachingProgress, type CompletionSite, type TeachingEditResult } from './teaching_completion';
import { locateTeachingChange, type TeachingDiagnostic, type TeachingStepLocation } from './teaching_location';
import './inline_copilot_tutor.css';
import './robot_dialog_tutor.css';

type Step = TeachingStepLocation;
type Verify = { passed: boolean; feedback: string };
type Mode = 'next' | 'reference' | 'verify';
type Plan = Extract<TeachingEditResult, { kind: 'edit' }>;
type Progress = ReturnType<typeof teachingProgress>;
type Pending = Extract<Progress, { kind: 'pending' }>;

function isStep(value: unknown): value is Step {
  return !!value && typeof value === 'object' && 'file' in value && typeof value.file === 'string' &&
    !!value.file && !value.file.startsWith('/') && !/[\\:]/.test(value.file) && !value.file.split('/').includes('..') &&
    'title' in value && typeof value.title === 'string' && 'instruction' in value && typeof value.instruction === 'string' &&
    (!('anchor' in value) || typeof value.anchor === 'string') && (!('scope' in value) || typeof value.scope === 'string') &&
    (!('line' in value) || (typeof value.line === 'number' && Number.isSafeInteger(value.line) && value.line > 0));
}

function isVerify(value: unknown): value is Verify {
  return !!value && typeof value === 'object' && 'passed' in value && typeof value.passed === 'boolean' &&
    'feedback' in value && typeof value.feedback === 'string';
}

const diagnosticText: Record<TeachingDiagnostic['kind'], string> = {
  'original-not-found': '找不到原文',
  ambiguous: '找到多个候选位置',
  'already-complete': '代码已经完成',
  'unsupported-range': '修改范围不受支持',
  'invalid-ai-data': 'AI 返回数据不合法',
};

const providerId = 'robot-teaching-completion';
const acceptedCommandId = `${providerId}.accepted`;

export function installInlineCopilotTutor(controller: EditorController, openFile: (file: string) => Promise<void>): void {
  if (/Android/i.test(navigator.userAgent) || document.getElementById('inline-copilot-launch')) return;
  const bar = document.querySelector<HTMLElement>('.commandbar');
  const api = window.tutorIde;
  if (!bar || !api?.handsonStep) return;
  const handsonStep = api.handsonStep;

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
  box.className = 'robot-dialog-tutor';
  box.hidden = true;
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
  let busy = false;
  let goal = '';
  let current: Step | null = null;
  let history: Step[] = [];
  let projectRoot = '';
  let cachedReference: unknown = null;
  let suggestion: {
    model: monaco.editor.ITextModel;
    plan: Plan;
    version: number;
    progress: Progress;
    reported: Progress;
  } | null = null;
  let frame = 0;
  let teachingVisibleAtCursor = false;
  let dismissed = false;
  const deletions = editor.createDecorationsCollection();

  function say(message: string): void { bubble.textContent = message; }

  function setPhase(phase: 'goal' | 'choice' | 'writing' | 'passed'): void {
    choices.hidden = phase !== 'choice';
    footer.hidden = phase === 'goal' || phase === 'choice';
    restore.hidden = phase !== 'writing' || !cachedReference;
    check.hidden = phase !== 'writing';
    next.hidden = phase !== 'passed';
    input.placeholder = phase === 'goal' ? '输入你想开发的功能…' : '也可以直接输入回复…';
  }

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    const controls = [input, send, yes, no, restore, check, next];
    controls.forEach(control => { control.disabled = true; });
    try { await task(); }
    catch (error) { say(error instanceof Error ? error.message : String(error)); }
    finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
    }
  }

  const overlay: monaco.editor.IOverlayWidget = {
    getId: () => 'inline-copilot-tutor-widget',
    getDomNode: () => box,
    getPosition: () => ({ preference: monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER }),
  };
  editor.addOverlayWidget(overlay);

  function currentProgress(model: monaco.editor.ITextModel): Progress | undefined {
    if (suggestion?.model !== model) return;
    if (suggestion.version !== model.getVersionId()) {
      suggestion.progress = teachingProgress(suggestion.plan, model.getValue());
      suggestion.version = model.getVersionId();
    }
    return suggestion.progress;
  }

  function completionAt(model: monaco.editor.ITextModel, position: monaco.IPosition) {
    const selections = editor.getSelections();
    if (box.hidden || dismissed || editor.getModel() !== model ||
        !editor.hasTextFocus() || selections?.length !== 1 || !selections[0].isEmpty() ||
        !selections[0].getPosition().equals(position)) return;

    const progress = currentProgress(model);
    if (progress?.kind !== 'pending') return;
    const { site } = progress;
    const start = model.getPositionAt(site.start);
    if (!start.equals(position)) return;
    const end = model.getPositionAt(site.end);
    const range = monaco.Range.fromPositions(start, end);
    const item: monaco.languages.InlineCompletion = {
      insertText: site.text, range, showRange: monaco.Range.fromPositions(start),
      isInlineEdit: !range.isEmpty() || (site.text.includes('\n') && end.column !== model.getLineMaxColumn(end.lineNumber)),
    };
    // Native Inline Edit can align a word within its replacement as unchanged.
    // A single-line ghost plus an adjacent removal renders the exact old/new pair
    // with the same native acceptance and undo transaction.
    if (!range.isEmpty() && start.lineNumber === end.lineNumber && site.text && !site.text.includes('\n')) {
      return { progress, item: { ...item, range: monaco.Range.fromPositions(start),
        isInlineEdit: false, additionalTextEdits: [{ range, text: '' }] } };
    }
    return { progress, item };
  }

  function showDeletions(model: monaco.editor.ITextModel, site: CompletionSite): void {
    const start = model.getPositionAt(site.start);
    const end = model.getPositionAt(site.end);
    const marks: monaco.editor.IModelDeltaDecoration[] = [];
    for (let line = start.lineNumber; line <= end.lineNumber; line++) {
      const first = line === start.lineNumber ? start.column : 1;
      const last = line === end.lineNumber ? end.column : model.getLineMaxColumn(line);
      const wholeLine = !site.text && first === 1 && last === model.getLineMaxColumn(line) &&
        (last > first || line < end.lineNumber);
      const range = new monaco.Range(line, first, line, last);
      if (last > first) marks.push({ range, options: { inlineClassName: 'teaching-delete-text' } });
      if (wholeLine) marks.push({ range, options: { isWholeLine: true,
        className: 'teaching-delete-line', lineNumberClassName: 'teaching-delete-line-number' } });
    }
    deletions.set(marks);
  }

  function describePending(model: monaco.editor.ITextModel, pending: Pending): void {
    const { site, index } = pending;
    const start = model.getPositionAt(site.start);
    const end = model.getPositionAt(site.end);
    const firstLine = !site.text && start.column === model.getLineMaxColumn(start.lineNumber) && start.lineNumber < end.lineNumber &&
      start.column > 1 ? start.lineNumber + 1 : start.lineNumber;
    const lastLine = end.column === 1 && end.lineNumber > firstLine ? end.lineNumber - 1 : end.lineNumber;
    const location = firstLine === lastLine ? `第 ${firstLine} 行` : `第 ${firstLine}–${lastLine} 行`;
    const action = !site.text ? '删除' : site.start === site.end ? '新增' : '替换';
    restore.hidden = false;
    say(`已准备好提示。第 ${index + 1} / ${suggestion?.plan.edits.length} 处 · ${location} · ${action}\n可手动编辑、按 Tab 接受，或点“重显提示”定位。`);
  }

  function describeComplete(): void {
    restore.hidden = true;
    say('当前步骤的建议修改已全部完成。可以点击“检查代码”。');
  }

  function locateCompletion(model: monaco.editor.ITextModel, site: CompletionSite): void {
    if (box.hidden || model !== editor.getModel()) return;
    dismissed = false;
    const position = model.getPositionAt(site.start);
    editor.setPosition(position);
    editor.revealPositionInCenterIfOutsideViewport(position);
    editor.focus();
    refreshCompletion();
  }

  editor.updateOptions({ inlineSuggest: { enabled: true, syntaxHighlightingEnabled: false } });
  const acceptedCommand = monaco.editor.registerCommand(acceptedCommandId, (_accessor, plan: Plan, index: number) => {
    const model = editor.getModel();
    if (!model || suggestion?.plan !== plan) return;
    const pending = currentProgress(model);
    if (pending?.kind === 'pending' && pending.index > index) locateCompletion(model, pending.site);
  });
  const provider = monaco.languages.registerInlineCompletionsProvider('*', {
    groupId: providerId,
    provideInlineCompletions(model, position, _context, token) {
      const match = !token.isCancellationRequested && completionAt(model, position);
      if (!match || !suggestion) return { items: [] };
      return { items: [{ ...match.item, command: {
        id: acceptedCommandId, title: '定位下一处教学修改', arguments: [suggestion.plan, match.progress.index],
      } }], suppressSuggestions: true };
    },
    disposeInlineCompletions() {},
  });

  function hideCompletion(): void {
    deletions.clear();
    // Monaco's hide action focuses the editor, so only run it while focused.
    if (!teachingVisibleAtCursor || !editor.hasTextFocus()) return;
    teachingVisibleAtCursor = false;
    editor.trigger(providerId, 'editor.action.inlineSuggest.hide', {});
  }

  function refreshCompletion(): void {
    if (frame || !suggestion) return;
    // Monaco settles its cursor/undo transaction before we request a fresh item.
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const position = editor.getPosition();
      const model = editor.getModel();
      const match = model && position && completionAt(model, position);
      if (!match || !model) {
        hideCompletion();
        return;
      }
      teachingVisibleAtCursor = true;
      showDeletions(model, match.progress.site);
      editor.trigger(providerId, 'editor.action.inlineSuggest.trigger', { providerId });
    });
  }

  function refreshAtCursor(): void {
    const model = editor.getModel();
    const position = editor.getPosition();
    const pending = model && currentProgress(model);
    if (model && position && dismissed && pending?.kind === 'pending' && !model.getPositionAt(pending.site.start).equals(position)) {
      dismissed = false;
    }
    if (teachingVisibleAtCursor && (!model || !position || !completionAt(model, position))) hideCompletion();
    refreshCompletion();
  }

  editor.onDidChangeCursorSelection(refreshAtCursor);
  editor.onDidChangeModel(() => { deletions.clear(); refreshCompletion(); });
  editor.onDidChangeModelContent(() => {
    const model = editor.getModel();
    if (model && suggestion?.model === model) {
      const previous = suggestion.reported;
      const progress = currentProgress(model);
      if (progress) suggestion.reported = progress;
      // Additional deletion ranges belong to the previous model version.
      if (deletions.length || progress?.kind !== 'pending') hideCompletion();
      if (progress?.kind === 'pending' && (previous.kind !== 'pending' || previous.index !== progress.index)) {
        dismissed = false;
        describePending(model, progress);
      } else if (progress?.kind === 'complete' && previous.kind !== 'complete') {
        describeComplete();
      } else if (progress?.kind === 'diverged' && previous.kind !== 'diverged') {
        restore.hidden = false;
        say('代码已变化，暂时无法核对剩余修改。完成手动编辑后可点击“重显提示”或“检查代码”。');
      }
    }
    refreshCompletion();
  });
  editor.onDidFocusEditorText(refreshAtCursor);
  editor.onDidBlurEditorText(() => deletions.clear());
  editor.onKeyDown(event => {
    if (event.keyCode !== monaco.KeyCode.Escape || !teachingVisibleAtCursor) return;
    dismissed = true;
    hideCompletion();
  });
  editor.onDidDispose(() => {
    provider.dispose();
    acceptedCommand.dispose();
    window.cancelAnimationFrame(frame);
    holder.remove();
  });

  function clearReference(): void {
    cachedReference = null;
    suggestion = null;
    dismissed = false;
    restore.hidden = true;
    hideCompletion();
  }

  function setOpen(open: boolean): void {
    box.hidden = !open;
    editor.layoutOverlayWidget(overlay);
    if (open) {
      const otherPanel = document.getElementById('mentor-course-panel');
      if (otherPanel) otherPanel.hidden = true;
      input.focus();
    } else {
      editor.focus();
      hideCompletion();
    }
  }
  launch.addEventListener('click', () => setOpen(box.hidden));
  el<HTMLButtonElement>('[data-close]').addEventListener('click', () => setOpen(false));
  for (const event of ['pointerdown', 'mousedown', 'click']) {
    box.addEventListener(event, e => e.stopPropagation());
  }

  async function getProject() {
    const project = await api.restoreProject();
    if (!project) throw new Error('请先打开一个本地项目。');
    if (project.rootPath !== projectRoot) {
      projectRoot = project.rootPath;
      history = [];
      current = null;
      clearReference();
      setPhase('goal');
    }
    return project;
  }

  async function targetModel(step: Step): Promise<monaco.editor.ITextModel> {
    const project = await getProject();
    if (step !== current) throw new Error('项目已切换。请回复“下一步”来开始新项目的教学。');
    if (!project.files.includes(step.file)) throw new Error(`请先创建目标文件 ${step.file}，再试一次。`);
    if (controller.path !== step.file) await openFile(step.file);
    const model = editor.getModel();
    if (!model || controller.path !== step.file || editor.getOption(monaco.editor.EditorOption.readOnly)) {
      throw new Error(`无法在编辑器中打开可编辑的 ${step.file}。`);
    }
    return model;
  }

  function request(mode: Mode, model?: monaco.editor.ITextModel, relocation?: TeachingDiagnostic): Promise<unknown> {
    return handsonStep({ mode, goal, previous: current, history, projectRoot,
      ...(model && current ? { buffer: { file: current.file, content: model.getValue() } } : {}),
      ...(relocation ? { relocation } : {}),
    });
  }

  async function nextStep(): Promise<void> {
    await getProject();
    say('我先看看项目，找出下一步…');
    const result = await request('next');
    if (!isStep(result)) throw new Error('AI 没有返回可用的教学步骤。请回复“下一步”重试。');
    clearReference();
    current = result;
    history.push(result);
    setPhase('choice');
    say(`第 ${history.length} 步：${result.title}\n文件：${result.file}\n${result.instruction}\n\n这一步你会写吗？`);
  }

  async function writeOnMyOwn(): Promise<void> {
    if (!current) return;
    await targetModel(current);
    clearReference();
    setPhase('writing');
    say(`请在 ${current.file} 里试着写。完成后点击“检查代码”。需要提示时，可以回复“不会写”。`);
  }

  async function prepareCompletion(model: monaco.editor.ITextModel, step: Step, reference: unknown): Promise<TeachingEditResult | undefined> {
    const { isSafeTeachingCode, teachingScopes } = await import('./teaching_code_validation');
    if (model.isDisposed() || step !== current) return;
    const source = model.getValue();
    const location = locateTeachingChange(source, reference, step, teachingScopes(step.file, source));
    if (location.kind !== 'located') return location;
    const plan = planTeachingEdits(source, location, model.getEOL());
    if (plan.kind !== 'edit') return plan;
    if (!plan.edits.every(edit => isSafeTeachingCode(step.file, edit))) {
      return { kind: 'unsupported-range', detail: '应用该修改会产生语法错误、重复声明，或无法验证改动内容。', candidates: [location.candidate] };
    }
    const progress = teachingProgress(plan, source);
    suggestion = { model, plan, version: model.getVersionId(), progress, reported: progress };
    cachedReference = reference;
    dismissed = false;
    setPhase('writing');
    return plan;
  }

  function logDiagnostic(step: Step, result: TeachingDiagnostic, attempt: 'initial' | 'relocation' | 'cached'): void {
    console.debug(`[teaching-completion] ${result.kind}`, {
      file: step.file, attempt, detail: result.detail, candidates: result.candidates, candidateCount: result.candidateCount,
    });
  }

  function showDiagnostic(result: TeachingDiagnostic): void {
    if (result.kind === 'already-complete') {
      restore.hidden = true;
      say('代码已经完成。可以点击“检查代码”。');
      return;
    }
    const candidates = result.candidates ?? [];
    const locations = candidates.map(({ line, column, scope }) => `${line}:${column}${scope ? `（${scope}）` : ''}`).join('、');
    const extra = (result.candidateCount ?? 0) - candidates.length;
    const locationText = locations ? `\n候选位置 ${locations}${extra > 0 ? `，另有 ${extra} 处` : ''}` : '';
    say(`定位失败 · ${diagnosticText[result.kind]}。${result.detail ?? ''}${locationText}`);
  }

  async function requestCompletion(model: monaco.editor.ITextModel, step: Step, failure?: TeachingDiagnostic): Promise<boolean> {
    // Each attempt reads the live model again, including edits made while the first request was in flight.
    let diagnostic = failure;
    for (const attempt of failure ? ['relocation'] as const : ['initial', 'relocation'] as const) {
      if (attempt === 'relocation') say('正在根据最新缓冲区重新定位…');
      const reference = await request('reference', model, diagnostic);
      const result = await prepareCompletion(model, step, reference);
      if (!result) return false;
      if (result.kind === 'edit') return true;
      logDiagnostic(step, result, attempt);
      diagnostic = result;
      if (result.kind === 'already-complete') break;
    }
    clearReference();
    setPhase('writing');
    if (diagnostic) showDiagnostic(diagnostic);
    return false;
  }

  async function restoreCompletion(): Promise<void> {
    if (!current || !cachedReference) return;
    const step = current;
    const model = await targetModel(step);
    let progress = currentProgress(model);
    if (!progress || progress.kind === 'diverged') {
      const result = await prepareCompletion(model, step, cachedReference);
      if (!result) return;
      if (result.kind !== 'edit') {
        logDiagnostic(step, result, 'cached');
        if (result.kind === 'already-complete') {
          clearReference();
          showDiagnostic(result);
          return;
        }
        if (!await requestCompletion(model, step, result)) return;
      }
      progress = currentProgress(model);
    }
    if (progress?.kind !== 'pending') return;
    describePending(model, progress);
    locateCompletion(model, progress.site);
  }

  async function showReference(): Promise<void> {
    if (!current) return;
    const step = current;
    const model = await targetModel(step);
    const existing = currentProgress(model);
    if (existing?.kind === 'complete') {
      describeComplete();
      return;
    }
    if (existing?.kind === 'pending') {
      dismissed = false;
      describePending(model, existing);
      refreshCompletion();
      return;
    }
    say(`正在为 ${step.file} 准备代码提示…`);
    if (await requestCompletion(model, step)) {
      const progress = currentProgress(model);
      if (progress?.kind === 'pending') describePending(model, progress);
      if (!box.hidden && model === editor.getModel() && document.activeElement === document.body) editor.focus();
      refreshCompletion();
    }
  }

  async function verify(): Promise<void> {
    if (!current || check.hidden || footer.hidden) return;
    const model = await targetModel(current);
    const progress = currentProgress(model);
    if (progress?.kind === 'pending') {
      describePending(model, progress);
      return;
    }
    const version = model.getVersionId();
    say('我来检查你写的代码…');
    const result = await request('verify', model);
    if (model.isDisposed() || model.getVersionId() !== version) {
      say('检查期间代码发生了变化。请再次点击“检查代码”。');
      return;
    }
    if (!isVerify(result)) throw new Error('AI 暂时无法检查这一步，请再试一次。');
    if (result.passed) {
      clearReference();
      setPhase('passed');
      say(`${result.feedback || '写对了！'}\n\n要继续下一步吗？`);
    } else {
      say(`${result.feedback || '还有地方需要调整。'}\n\n可以继续编辑，或回复“不会写”获取提示。`);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const reply = input.value.trim();
    if (!reply || busy) return;
    input.value = '';
    if (!goal || !current) {
      if (!goal || !/^(下一步|继续|继续下一步)$/.test(reply)) goal = reply;
      void run(nextStep);
    } else if (/^(不会|不会写|不懂|不会啊|不会呢|不知道|给我提示|提示|no|help)$/i.test(reply)) {
      void run(showReference);
    } else if (/^(会|会写|我会|我会写|yes|自己写)$/i.test(reply)) {
      void run(writeOnMyOwn);
    } else if (/^(检查|检查代码|写好了|完成了|好了)$/.test(reply)) {
      void run(verify);
    } else if (/^(下一步|继续|继续下一步)$/.test(reply)) {
      if (!next.hidden) void run(nextStep);
      else say('先完成并检查这一步，再继续。');
    } else {
      say('你可以回复“我会写”“不会写”或“写好了”。');
    }
  });
  yes.addEventListener('click', () => { void run(writeOnMyOwn); });
  no.addEventListener('click', () => { void run(showReference); });
  restore.addEventListener('click', () => { void run(restoreCompletion); });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyG, () => {
    if (!box.hidden && !restore.hidden) void run(restoreCompletion);
  });
  check.addEventListener('click', () => { void run(verify); });
  next.addEventListener('click', () => { void run(nextStep); });
}
