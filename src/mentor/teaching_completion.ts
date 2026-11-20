import type { LocatedTeachingChange, TeachingDiagnostic } from './teaching_location';

export type TeachingEdit = {
  before: string;
  after: string;
  original: string;
  insertText: string;
};

export type TeachingEditResult =
  | { kind: 'edit'; edits: TeachingEdit[]; target: string }
  | TeachingDiagnostic;

const normalize = (text: string): string => text.replace(/\r\n?/g, '\n');

function lineMatches(source: string, block: string): number[] {
  const matches: number[] = [];
  for (let from = 0; from <= source.length;) {
    const start = source.indexOf(block, from);
    if (start < 0) break;
    const end = start + block.length;
    if ((start === 0 || source[start - 1] === '\n') &&
        (end === source.length || source[end] === '\n')) matches.push(start);
    if (matches.length > 1) break;
    from = start + 1;
  }
  return matches;
}

type Change = { offset: number; original: string; text: string };

function trimChange(offset: number, original: string, text: string): Change {
  const oldChars = Array.from(original);
  const newChars = Array.from(text);
  const sharedLength = Math.min(oldChars.length, newChars.length);
  let start = 0;
  while (start < sharedLength && oldChars[start] === newChars[start]) start++;
  let end = 0;
  while (end < sharedLength - start && oldChars.at(-1 - end) === newChars.at(-1 - end)) end++;
  return {
    offset: offset + oldChars.slice(0, start).join('').length,
    original: oldChars.slice(start, oldChars.length - end).join(''),
    text: newChars.slice(start, newChars.length - end).join(''),
  };
}

// Keep newline delimiters with their lines so a whole-line deletion has an exact range.
function lineChanges(original: string, text: string): Change[] {
  const oldLines = original.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const newLines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const lengths = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      lengths[i][j] = oldLines[i] === newLines[j] ? 1 + lengths[i + 1][j + 1] : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const changes: Change[] = [];
  let i = 0;
  let j = 0;
  let offset = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      offset += oldLines[i++].length;
      j++;
      continue;
    }
    const from = i;
    const to = j;
    while ((i < oldLines.length || j < newLines.length) && oldLines[i] !== newLines[j]) {
      if (j === newLines.length || (i < oldLines.length && lengths[i + 1][j] >= lengths[i][j + 1])) i++;
      else j++;
    }
    const removed = oldLines.slice(from, i);
    const added = newLines.slice(to, j);
    // Two identical adjacent statements can collapse to one updated statement.
    // Keep the first occurrence for the replacement and remove the later copies.
    const repeated = added.length === 1 && removed.length > 1 && removed.every(line => line === removed[0]);
    const paired = removed.length === added.length || repeated ? added.length : 0;
    for (let k = 0; k < paired; k++) {
      changes.push(trimChange(offset, removed[k], added[k]));
      offset += removed[k].length;
    }
    const rest = removed.slice(paired).join('');
    const addition = added.slice(paired).join('');
    if (rest || addition) changes.push(trimChange(offset, rest, addition));
    offset += rest.length;
  }
  return changes;
}

export function planTeachingEdits(
  source: string, location: LocatedTeachingChange,
  eol = source.includes('\r\n') ? '\r\n' : '\n',
): TeachingEditResult {
  const actual = normalize(source);
  const { original: existing, replacement, wholeLines, candidate } = location;
  let offset = location.offset;
  const unsupported = (detail: string): TeachingDiagnostic => ({ kind: 'unsupported-range', detail, candidates: [candidate] });
  if (actual.slice(offset, offset + existing.length) !== existing) return { kind: 'original-not-found', candidates: [candidate] };
  const deletingBlock = !replacement;
  let originalBlock = existing;
  let targetBlock = replacement;
  if (wholeLines && existing.endsWith('\n')) {
    if (!deletingBlock && !targetBlock.endsWith('\n')) targetBlock += '\n';
  } else if (wholeLines && actual[offset + existing.length] === '\n') {
    originalBlock += '\n';
    if (!deletingBlock && !targetBlock.endsWith('\n')) targetBlock += '\n';
  } else if (wholeLines && deletingBlock && offset > 0) {
    originalBlock = '\n' + originalBlock;
    offset--;
  }
  if (originalBlock.split('\n').length > 500 || targetBlock.split('\n').length > 500) return unsupported('给出的代码块超过当前定位器支持的 500 行。');
  const nativeEol = (text: string) => text.replace(/\n/g, eol);
  const changes = lineChanges(originalBlock, targetBlock);
  if (changes.length > 12) return unsupported('这条建议包含超过 12 处修改，需要拆成更小的教学步骤。');
  const comparable = (text: string) => text.trim().split('\n').map(line => line.trim()).join('\n');
  const edits: TeachingEdit[] = [];
  let working = actual;
  let shift = 0;
  for (const change of changes) {
    let start = offset + change.offset + shift;
    const original = change.original;
    let insertText = change.text;
    if (insertText && original.includes('\n')) return unsupported('需要同时替换多行旧代码，无法拆成单独的行内修改。');
    if (!original && insertText.endsWith('\n') && lineMatches(comparable(originalBlock), comparable(insertText)).length) {
      if (changes.length === 1) return { kind: 'already-complete', candidates: [candidate] };
      return unsupported('这组修改包含会重复添加的现有代码。');
    }
    // Render added lines as ghost text at the end of the preceding line.
    if (!original && start > 0 && working[start - 1] === '\n' && insertText.endsWith('\n')) {
      start--;
      insertText = '\n' + insertText.slice(0, -1);
    }
    const before = working.slice(0, start);
    const after = working.slice(start + original.length);
    edits.push({ before: nativeEol(before), after: nativeEol(after), original: nativeEol(original), insertText: nativeEol(insertText) });
    working = before + insertText + after;
    shift += insertText.length - original.length;
  }
  const expected = actual.slice(0, offset) + targetBlock + actual.slice(offset + originalBlock.length);
  if (!edits.length || working !== expected) return unsupported('无法核对拆分后的修改范围。');
  return { kind: 'edit', edits, target: nativeEol(working) };
}

export function teachingProgress(plan: { edits: TeachingEdit[]; target: string }, source: string) {
  if (source === plan.target) return { kind: 'complete' } as const;
  for (const [index, edit] of plan.edits.entries()) {
    const site = remainingTeachingEdit(edit, source);
    if (site) return { kind: 'pending', site, index } as const;
  }
  return { kind: 'diverged' } as const;
}

export type CompletionSite = { start: number; end: number; text: string };

// Compare against the immutable surroundings of the verified edit. Cursor
// movement and focus don't affect the plan, and edits outside it suspend it.
export function remainingTeachingEdit(edit: TeachingEdit, source: string): CompletionSite | undefined {
  if (source.length < edit.before.length + edit.after.length ||
      !source.startsWith(edit.before) || !source.endsWith(edit.after)) return;
  const start = edit.before.length;
  const end = source.length - edit.after.length;
  const typed = source.slice(start, end);
  if (typed === edit.insertText) return;
  if (typed === edit.original && typed !== '') return { start, end, text: edit.insertText };
  if (!edit.insertText && !trimChange(0, edit.original, typed).text) return { start, end, text: '' };
  if (edit.insertText.startsWith(typed)) return { start: end, end, text: edit.insertText.slice(typed.length) };

  // Monaco may insert a matching closing bracket while the learner types.
  // Only account for a single closer reproduced by the validated edit.
  let prefixLength = 0;
  while (prefixLength < typed.length && typed[prefixLength] === edit.insertText[prefixLength]) prefixLength++;
  const prefix = typed.slice(0, prefixLength);
  const tail = typed.slice(prefixLength);
  if (!/^[ \t\r\n]*[)\]}]$/.test(tail)) return;
  const closer = tail.at(-1)!;
  const opener = closer === ')' ? '(' : closer === ']' ? '[' : '{';
  const position = start + prefixLength;
  if (!prefix.includes(opener)) return;
  const remaining = edit.insertText.slice(prefixLength);
  if (remaining.endsWith(tail)) return { start: position, end: position, text: remaining.slice(0, -tail.length) };
  if (tail === closer && remaining.includes(closer)) return { start: position, end, text: remaining };
}
