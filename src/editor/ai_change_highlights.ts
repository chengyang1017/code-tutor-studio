import { monaco } from './monaco_setup';
import type { EditorController } from './editor_controller';
import './ai_change_highlights.css';

type Kind = 'added' | 'modified';
type Change = { start: number; end: number; kind: Kind };
type RecordOfChanges = { path: string; changes: Change[]; added: number; modified: number; removed: number };
type Input = { files: Array<{ path: string; before: string | null }> };

function compareLines(before: string | null, after: string): Omit<RecordOfChanges, 'path'> {
  const newer = after.split(/\r?\n/);
  if (before === null) return { changes: [{ start: 1, end: Math.max(1, newer.length), kind: 'added' }], added: newer.length, modified: 0, removed: 0 };
  const older = before.split(/\r?\n/);
  let i = 0;
  let j = 0;
  let added = 0;
  let modified = 0;
  let removed = 0;
  const changes: Change[] = [];
  while (i < older.length || j < newer.length) {
    if (i < older.length && j < newer.length && older[i] === newer[j]) { i++; j++; continue; }
    const start = j + 1;
    const oldStart = i;
    const newStart = j;
    let bestI = older.length;
    let bestJ = newer.length;
    let bestScore = Infinity;
    for (let dx = 0; dx <= 35 && i + dx < older.length; dx++) {
      for (let dy = 0; dy <= 35 && j + dy < newer.length; dy++) {
        if (older[i + dx] === newer[j + dy] && dx + dy < bestScore) {
          bestScore = dx + dy; bestI = i + dx; bestJ = j + dy;
        }
      }
    }
    if (!Number.isFinite(bestScore)) { i = older.length; j = newer.length; }
    else { i = bestI; j = bestJ; }
    const oldCount = i - oldStart;
    const newCount = j - newStart;
    const both = Math.min(oldCount, newCount);
    modified += both;
    added += newCount - both;
    removed += oldCount - both;
    if (newCount > 0) {
      changes.push({ start, end: start + newCount - 1, kind: oldCount ? 'modified' : 'added' });
    } else if (newer.length > 0) {
      const marker = Math.min(Math.max(1, start), newer.length);
      changes.push({ start: marker, end: marker, kind: 'modified' });
    }
  }
  return { changes, added, modified, removed };
}

export function installAiChangeHighlights(controller: EditorController): void {
  const editor = controller.editor;
  const decorations = editor.createDecorationsCollection();
  const records = new Map<string, RecordOfChanges>();
  let generation = 0;
  let selectedIndex = -1;

  const widget = document.createElement('section');
  widget.className = 'ai-change-widget';
  widget.hidden = true;
  widget.setAttribute('aria-label', 'AI code changes');
  widget.innerHTML = `<div class="ai-change-widget-title">AI 代码修改提示</div>
    <div class="ai-change-widget-count" data-ai-change-count></div>
    <div class="ai-change-widget-nav">
      <button type="button" data-ai-change-prev title="上一处变更">上一处</button>
      <button type="button" data-ai-change-next title="下一处变更">下一处</button>
      <button type="button" data-ai-change-close title="隐藏提示">隐藏</button>
    </div>`;
  document.body.append(widget);
  const count = widget.querySelector<HTMLElement>('[data-ai-change-count]');
  let dismissed = false;

  function refresh(): void {
    const record = records.get(controller.path);
    const model = editor.getModel();
    if (!record || !model) {
      decorations.clear();
      widget.hidden = true;
      return;
    }
    const max = model.getLineCount();
    decorations.set(record.changes.map((change) => {
      const start = Math.max(1, Math.min(max, change.start));
      const end = Math.max(start, Math.min(max, change.end));
      const isAdded = change.kind === 'added';
      return {
        range: new monaco.Range(start, 1, end, model.getLineMaxColumn(end)),
        options: {
          isWholeLine: true,
          className: isAdded ? 'ai-change-line-added' : 'ai-change-line-modified',
          linesDecorationsClassName: isAdded ? 'ai-change-gutter-added' : 'ai-change-gutter-modified',
          overviewRuler: { color: isAdded ? '#40d48c' : '#f5bd55', position: monaco.editor.OverviewRulerLane.Full },
          minimap: { color: isAdded ? '#40d48c' : '#f5bd55', position: monaco.editor.MinimapPosition.Inline },
          hoverMessage: { value: isAdded ? 'AI 新增代码' : 'AI 修改代码' },
        },
      };
    }));
    if (count) count.textContent = `${record.path}  |  新增 ${record.added} 行 · 修改 ${record.modified} 行 · 删除 ${record.removed} 行`;
    widget.hidden = dismissed;
  }

  function navigate(direction: number): void {
    const record = records.get(controller.path);
    if (!record || record.changes.length === 0) return;
    selectedIndex = (selectedIndex + direction + record.changes.length) % record.changes.length;
    editor.revealLineInCenter(record.changes[selectedIndex]!.start);
    editor.setPosition({ lineNumber: record.changes[selectedIndex]!.start, column: 1 });
  }
  widget.querySelector('[data-ai-change-prev]')?.addEventListener('click', () => navigate(-1));
  widget.querySelector('[data-ai-change-next]')?.addEventListener('click', () => navigate(1));
  widget.querySelector('[data-ai-change-close]')?.addEventListener('click', () => { dismissed = true; widget.hidden = true; });

  editor.onDidChangeModel(() => { selectedIndex = -1; refresh(); });
  // Some file reloads reuse an existing model rather than switch the model.
  editor.onDidChangeModelContent(() => refresh());

  window.addEventListener('code-tutor-ai-change-summary', (event: Event) => {
    const input = (event as CustomEvent<Input>).detail;
    if (!Array.isArray(input?.files)) return;
    const id = ++generation;
    void (async () => {
      const next = new Map<string, RecordOfChanges>();
      for (const file of input.files) {
        if (typeof file.path !== 'string') continue;
        try {
          const response = await window.tutorIde.readProjectFile(file.path);
          if (id !== generation) return;
          const result = compareLines(file.before, response.content);
          next.set(file.path.replaceAll('\\', '/'), { path: file.path, ...result });
        } catch (error) { console.warn('AI change highlight:', file.path, error); }
      }
      if (id !== generation) return;
      records.clear();
      for (const [key, record] of next) records.set(key, record);
      dismissed = false;
      selectedIndex = -1;
      refresh();
      // The code-generation flow may open the new file after this event.
      // The onDidChangeModel handler will reapply the decorations there.
      const active = records.get(controller.path);
      if (active?.changes[0]) editor.revealLineInCenter(active.changes[0].start);
    })();
  });
}
