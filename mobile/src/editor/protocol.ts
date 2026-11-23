export const maxEditorLength = 512 * 1024;
export type Selection = { from: number; to: number };
export type Diagnostic = Selection & { message: string; severity: 'error' | 'warning' };
export type Change = Selection & { text: string };
export type EditorCommand =
  | { type: 'open'; id: string; text: string; readOnly: boolean }
  | { type: 'forget'; id: string }
  | { type: 'replace'; id: string; before: string; text: string }
  | { type: 'mark'; id: string; range: Selection | null; reveal: boolean }
  | { type: 'diagnostics'; id: string; diagnostics: Diagnostic[] }
  | { type: 'wrap'; id: string; enabled: boolean }
  | { type: 'snapshot'; id: string }
  | { type: 'undo' | 'redo'; id: string };
export type EditorEvent =
  | { type: 'ready' }
  | { type: 'save' | 'stale' | 'limit'; id: string }
  | { type: 'selection'; id: string; selection: Selection }
  | { type: 'delta'; id: string; beforeLength: number; changes: Change[]; selection: Selection }
  | { type: 'change'; id: string; text: string; selection: Selection };

function isSelection(value: unknown, limit: number): value is Selection {
  const range = value as Partial<Selection> | null;
  return !!range && Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) &&
    range.from! >= 0 && range.from! <= range.to! && range.to! <= limit;
}

export function applyEditorChanges(source: string, changes: Change[]): string {
  const result: string[] = [];
  let offset = 0;
  for (const change of changes) {
    result.push(source.slice(offset, change.from), change.text);
    offset = change.to;
  }
  result.push(source.slice(offset));
  return result.join('');
}

export function decodeEditorEvent(payload: string): EditorEvent | undefined {
  if (payload.length > maxEditorLength * 6 + 2048) return;
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const event = value as { type?: unknown; id?: unknown; text?: unknown; selection?: unknown; beforeLength?: unknown; changes?: unknown };
  if ((value as { type?: string }).type === 'ready') return { type: 'ready' };
  if (typeof event.id !== 'string' || !event.id || event.id.length > 1050) return;
  const { id } = event;
  switch (event.type) {
    case 'save': case 'stale': case 'limit': return { type: event.type, id };
    case 'selection':
      if (isSelection(event.selection, maxEditorLength)) return { type: 'selection', id, selection: event.selection };
      break;
    case 'delta': {
      const { beforeLength, changes } = event;
      if (typeof beforeLength !== 'number' || !Number.isSafeInteger(beforeLength) || beforeLength < 0 ||
          beforeLength > maxEditorLength || !Array.isArray(changes) || !changes.length || changes.length > 128) return;
      let last = 0;
      let length = beforeLength;
      for (const change of changes) {
        if (!isSelection(change, beforeLength) || change.from < last || !('text' in change) || typeof change.text !== 'string') return;
        last = change.to;
        length += change.text.length - (change.to - change.from);
      }
      if (length <= maxEditorLength && isSelection(event.selection, length)) {
        return { type: 'delta', id, beforeLength, changes, selection: event.selection };
      }
      break;
    }
    case 'change':
      if (typeof event.text === 'string' && event.text.length <= maxEditorLength && isSelection(event.selection, event.text.length)) {
        return { type: 'change', id, text: event.text, selection: event.selection };
      }
  }
}

