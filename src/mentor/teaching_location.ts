export type TeachingScope = { name: string; start: number; end: number };

export type TeachingStepLocation = {
  file: string;
  title: string;
  instruction: string;
  anchor?: string;
  scope?: string;
  line?: number;
};

export type TeachingCandidate = { line: number; column: number; scope?: string };
export type TeachingDiagnostic = {
  kind: 'original-not-found' | 'ambiguous' | 'already-complete' | 'unsupported-range' | 'invalid-ai-data';
  detail?: string;
  candidates?: TeachingCandidate[];
  candidateCount?: number;
};

export type LocatedTeachingChange = {
  kind: 'located';
  offset: number;
  original: string;
  replacement: string;
  wholeLines: boolean;
  candidate: TeachingCandidate;
};

type TextRange = { startLine: number; startColumn: number; endLine: number; endColumn: number };
type Reference = {
  example: string;
  placement: {
    file: string;
    action: 'replace' | 'delete' | 'empty_file' | 'unknown';
    original?: string;
    anchor?: string;
    before?: string;
    after?: string;
    scope?: string;
    range?: TextRange;
  };
};

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');
const hasCodeText = /[\p{L}\p{N}_$]/u;
const wordCharacter = /[\p{ID_Continue}$]/u;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRange(value: unknown): value is TextRange {
  if (!record(value)) return false;
  const { startLine, startColumn, endLine, endColumn } = value;
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
  return positive(startLine) && positive(startColumn) && positive(endLine) && positive(endColumn) &&
    (endLine > startLine || (endLine === startLine && endColumn > startColumn));
}

function isReference(value: unknown): value is Reference {
  if (!record(value) || typeof value.example !== 'string' || value.example.length > 12000 || !record(value.placement)) return false;
  const place = value.placement;
  return typeof place.file === 'string' &&
    (place.action === 'replace' || place.action === 'delete' || place.action === 'empty_file' || place.action === 'unknown') &&
    ['original', 'anchor', 'before', 'after', 'scope'].every(key => place[key] === undefined ||
      (typeof place[key] === 'string' && place[key].length <= 12000)) &&
    (place.range === undefined || isRange(place.range));
}

function codeFromReference(example: string): string | undefined {
  const text = normalize(example).replace(/^\n+|\n+$/g, '');
  const fenced = /^\s*```(?:[\w+-]+)?[ \t]*\n([\s\S]*?)\n[ \t]*```\s*$/.exec(text);
  const code = fenced?.[1] ?? text;
  if (/^[ \t]*(?:```|~~~|[-*]\s+\*\*)/m.test(code)) return;
  return code;
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*(?:\/\/|#(?=\s|!|$)).*$/gm, '');
}

function isWholeLineSpan(source: string, start: number, end: number): boolean {
  return (start === 0 || source[start - 1] === '\n') &&
    (end === source.length || source[end] === '\n' || source[end - 1] === '\n');
}

function exactMatches(source: string, snippet: string, wholeLines = false): number[] {
  if (!snippet) return [];
  const matches: number[] = [];
  for (let from = 0; from < source.length;) {
    const start = source.indexOf(snippet, from);
    if (start < 0) break;
    const end = start + snippet.length;
    const withinToken = (wordCharacter.test(snippet[0]) && wordCharacter.test(source[start - 1] ?? '')) ||
      (wordCharacter.test(snippet.at(-1)!) && wordCharacter.test(source[end] ?? ''));
    if (!withinToken && (!wholeLines || isWholeLineSpan(source, start, end))) matches.push(start);
    from = start + 1;
  }
  return matches;
}

function firstDifference(original: string, replacement: string): number {
  let offset = 0;
  while (offset < original.length && original[offset] === replacement[offset]) offset++;
  return Math.min(offset, original.length - 1);
}

function narrowerBlock(original: string, replacement: string, context: number) {
  const oldLines = original.split('\n');
  const newLines = replacement.split('\n');
  const shared = Math.min(oldLines.length, newLines.length);
  let first = 0;
  while (first < shared && oldLines[first] === newLines[first]) first++;
  let last = 0;
  while (last < shared - first && oldLines.at(-1 - last) === newLines.at(-1 - last)) last++;
  first = Math.max(0, first - context);
  last = Math.max(0, last - context);
  return {
    original: oldLines.slice(first, oldLines.length - last).join('\n'),
    replacement: newLines.slice(first, newLines.length - last).join('\n'),
    shift: oldLines.slice(0, first).reduce((length, line) => length + line.length + 1, 0),
    hasContext: (first < shared && oldLines[first] === newLines[first] && hasCodeText.test(oldLines[first])) ||
      (last < shared && oldLines.at(-1 - last) === newLines.at(-1 - last) && hasCodeText.test(oldLines.at(-1 - last) ?? '')),
  };
}

function stripCopiedContext(source: string, offset: number, original: string, example: string): string {
  if (!example) return example;
  const end = offset + original.length;
  const before = source.slice(Math.max(0, offset - example.length), offset);
  const after = source.slice(end, end + example.length);
  let left = 0;
  let right = 0;
  for (const { index } of example.matchAll(/\n/g)) {
    if (before.endsWith(example.slice(0, index + 1)) && hasCodeText.test(example.slice(0, index))) left = index + 1;
    if (!right && after.startsWith(example.slice(index)) && hasCodeText.test(example.slice(index))) right = example.length - index;
  }
  if (left + right > 0 && left + right < example.length) return example.slice(left, example.length - right);

  // A response can give an expression as the original and its whole line as the example.
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const nextBreak = source.indexOf('\n', end);
  const linePrefix = source.slice(lineStart, offset);
  const lineSuffix = source.slice(end, nextBreak < 0 ? source.length : nextBreak);
  if (linePrefix.trim() && lineSuffix.trim() && !example.includes('\n') &&
      example.startsWith(linePrefix) && example.endsWith(lineSuffix) && linePrefix.length + lineSuffix.length < example.length) {
    return example.slice(linePrefix.length, -lineSuffix.length);
  }
  if (!example.includes('\n')) {
    let left = Math.min(linePrefix.length, example.length - 1);
    while (left >= 6 && !linePrefix.endsWith(example.slice(0, left))) left--;
    let right = Math.min(lineSuffix.length, example.length - left - 1);
    while (right > 0 && !lineSuffix.startsWith(example.slice(-right))) right--;
    if (left >= 6 && right > 0 && /[\p{L}_$].*[([{=]\s*$/u.test(example.slice(0, left)) &&
        /^\s*[)\]};,]/.test(example.slice(-right))) return example.slice(left, -right);
  }
  return example;
}

export function locateTeachingChange(
  source: string, raw: unknown, step: TeachingStepLocation, scopes: readonly TeachingScope[] = [],
): LocatedTeachingChange | TeachingDiagnostic {
  const actual = normalize(source);
  if (!isReference(raw)) {
    const detail = record(raw) && raw.error === 'invalid-json' ? 'AI 返回的内容无法解析为 JSON。' : 'AI 缺少有效的代码、原文或定位字段。';
    return { kind: 'invalid-ai-data', detail };
  }
  const { placement } = raw;
  if (placement.file.trim().replace(/\\/g, '/') !== step.file) {
    return { kind: 'invalid-ai-data', detail: 'AI 返回的目标文件与当前教学步骤不一致。' };
  }
  if (placement.action === 'unknown') return { kind: 'original-not-found', detail: 'AI 未能从当前缓冲区给出可核验的原文。' };
  const original = normalize(placement.original ?? placement.anchor ?? '');
  const replacement = codeFromReference(raw.example);
  const deleting = placement.action === 'delete';
  if (replacement === undefined || (deleting ? raw.example !== '' : !hasCodeText.test(withoutComments(replacement)))) {
    return { kind: 'invalid-ai-data', detail: 'AI 返回的替换内容为空、只有注释或包含说明文字。' };
  }
  if (placement.action === 'empty_file') {
    if (original || placement.range) return { kind: 'invalid-ai-data', detail: '空文件操作携带了原文范围。' };
    if (actual === replacement) return { kind: 'already-complete' };
    return actual === '' ? { kind: 'located', offset: 0, original, replacement, wholeLines: true, candidate: { line: 1, column: 1 } }
      : { kind: 'unsupported-range', detail: 'AI 建议初始化空文件，但目标缓冲区已有内容。' };
  }
  if (!original.trim()) return { kind: 'invalid-ai-data', detail: 'AI 未提供可核验的原文。' };

  const lines = [0, ...Array.from(actual.matchAll(/\n/g), match => match.index + 1)];
  function position(offset: number): TeachingCandidate {
    let lo = 0;
    let hi = lines.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (lines[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return { line: lo + 1, column: offset - lines[lo] + 1 };
  }
  function offsetAt(line: number, column: number): number | undefined {
    const start = lines[line - 1];
    const end = line < lines.length ? lines[line] - 1 : actual.length;
    return start !== undefined && start + column - 1 <= end ? start + column - 1 : undefined;
  }
  function scopeAt(offset: number): TeachingScope | undefined {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scope = scopes[i];
      if (scope.start <= offset && offset < scope.end) return scope;
    }
  }
  const range = placement.range;
  const rangeStart = range && offsetAt(range.startLine, range.startColumn);
  const rangeEnd = range && offsetAt(range.endLine, range.endColumn);
  const rangeVerified = rangeStart !== undefined && rangeEnd !== undefined && actual.slice(rangeStart, rangeEnd) === original;
  const anchorLocations = [placement.anchor, step.anchor].map(anchor => normalize(anchor ?? ''))
    .filter(anchor => anchor !== original && hasCodeText.test(anchor))
    .map(anchor => exactMatches(actual, anchor).map(start => ({ start, end: start + anchor.length,
      scope: scopeAt(start + anchor.search(/\S/)) })));
  const stepWords = new Set(`${step.title} ${step.instruction}`.split(/[^A-Za-z0-9_$]+/));

  function select(matches: number[], oldText: string, changedAt: number, shifted = 0) {
    const all = matches.map(offset => {
      const focus = offset + Math.max(0, changedAt);
      const scope = scopeAt(focus);
      const candidate = position(offset);
      return { offset, focus, scope, candidate: scope ? { ...candidate, scope: scope.name } : candidate };
    });
    let viable = all;
    let corroborated = false;
    const narrow = (matchesEvidence: (item: typeof all[number]) => boolean, required = false) => {
      const matching = new Set(all.filter(matchesEvidence));
      if (matching.size || required) {
        viable = viable.filter(item => matching.has(item));
        corroborated ||= matching.size > 0;
      }
    };
    for (const name of [placement.scope, step.scope]) {
      if (name && scopes.length) narrow(item => item.scope?.name === name || item.scope?.name.endsWith(`.${name}`) === true, true);
    }
    const named = new Set(scopes.filter(scope => stepWords.has(scope.name.split('.').at(-1)!)).map(scope => scope.name));
    if (named.size === 1 && all.length && all.every(item => item.scope)) {
      narrow(item => !!item.scope && named.has(item.scope.name), true);
    }

    for (const [side, rawContext] of [['before', placement.before], ['after', placement.after]] as const) {
      const context = normalize(rawContext ?? '');
      if (!hasCodeText.test(context)) continue;
      narrow(({ offset }) => side === 'before'
        ? actual.slice(Math.max(0, offset - context.length), offset) === context
        : actual.startsWith(context, offset + oldText.length), actual.includes(context));
    }
    for (const anchors of anchorLocations) {
      narrow(({ offset, focus, scope }) => anchors.some(anchor => {
        if (anchor.start < offset + oldText.length && anchor.end > offset) return true;
        const neighbor = anchor.end <= offset ? anchor.end : anchor.start;
        return Math.abs(position(neighbor).line - position(focus).line) <= 4 &&
          (!scopes.length || anchor.scope === scope);
      }));
    }
    if (corroborated && viable.length > 1) {
      const atRange = rangeVerified ? viable.find(item => item.offset === rangeStart + shifted) : undefined;
      const atLessonLine = step.line ? viable.filter(item => position(item.focus).line === step.line || item.candidate.line === step.line) : [];
      if (atRange && (atLessonLine.length !== 1 || atLessonLine[0] === atRange)) viable = [atRange];
      else if (!atRange && atLessonLine.length === 1) viable = atLessonLine;
    }
    const presented = viable.length ? viable : all;
    return { viable, corroborated, candidates: presented.slice(0, 8).map(item => item.candidate), candidateCount: presented.length };
  }

  const legacyWholeLines = placement.original === undefined;
  const narrowed = deleting ? [] : [2, 1, 0].map(context => narrowerBlock(original, replacement, context));
  const tried = new Set<string>();
  let reported: Pick<TeachingDiagnostic, 'candidates' | 'candidateCount'> = {};
  for (const block of [{ original, replacement, shift: 0, hasContext: true }, ...narrowed]) {
    if (!block.original.trim() || tried.has(block.original)) continue;
    tried.add(block.original);
    const changedAt = firstDifference(block.original, block.replacement);
    const matches = exactMatches(actual, block.original, block.original !== original || legacyWholeLines);
    const { viable, corroborated, candidates, candidateCount } = select(matches, block.original, changedAt, block.shift);
    if (viable.length > 1) return { kind: 'ambiguous', candidates, candidateCount };
    if (candidateCount) reported = { candidates, candidateCount };
    if (viable.length !== 1 || (!block.hasContext && !corroborated)) continue;
    const { offset, candidate } = viable[0];
    const proposed = stripCopiedContext(actual, offset, block.original, block.replacement);
    if (block.original === proposed) return { kind: 'already-complete', candidates: [candidate] };
    const codeLines = (text: string) => withoutComments(text).split('\n').filter(line => line.trim()).join('\n').trim();
    if (codeLines(block.original) === codeLines(proposed)) {
      return { kind: 'invalid-ai-data', detail: '建议只改变了注释或空行。', candidates: [candidate] };
    }
    return { kind: 'located', offset, original: block.original, replacement: proposed,
      wholeLines: isWholeLineSpan(actual, offset, offset + block.original.length), candidate };
  }

  if (!deleting && replacement !== original) {
    const applied = select(exactMatches(actual, replacement, legacyWholeLines), replacement, firstDifference(replacement, original));
    const sharedLine = replacement.includes('\n') && (original.split('\n')[0] === replacement.split('\n')[0] ||
      original.split('\n').at(-1) === replacement.split('\n').at(-1));
    if (applied.viable.length === 1 && (sharedLine || applied.corroborated)) {
      return { kind: 'already-complete', candidates: applied.candidates };
    }
  }
  if ((reported.candidateCount ?? 0) > 1) {
    return { kind: 'ambiguous', detail: '原文存在多个位置，作用域或附近源码与定位线索冲突。', ...reported };
  }
  return { kind: 'original-not-found', ...(reported.candidateCount ? { detail: '找到相似片段，但其作用域或上下文无法核实。' } : {}), ...reported };
}
