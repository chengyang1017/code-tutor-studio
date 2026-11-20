import assert from 'node:assert/strict';
import test from 'node:test';
import { planTeachingEdits, remainingTeachingEdit, teachingProgress } from '../src/mentor/teaching_completion.ts';
import { locateTeachingChange } from '../src/mentor/teaching_location.ts';
import { isSafeTeachingCode, teachingScopes } from '../src/mentor/teaching_code_validation.ts';

const login = 'function login(username: string) {\n  const name = username.trim();\n  return name;\n}';
const validation = login.replace('  return name;', '  if (!name) {\n    return null;\n  }\n  return name;');
const step = { file: 'login.ts', title: '', instruction: '' };
const plan = (source, example, anchor = source, action = 'replace', eol) =>
  resolve(source, { example, placement: { file: step.file, action, anchor } }, step, eol);

function resolve(source, reference, lesson = step, eol) {
  const location = locateTeachingChange(source, reference, lesson, teachingScopes(lesson.file, source));
  return location.kind === 'located' ? planTeachingEdits(source, location, eol) : location;
}

function reference(example, placement) {
  return { example, placement: { file: step.file, action: 'replace', ...placement } };
}

function editFor(source, desired, anchor) {
  const result = plan(source, desired, anchor);
  assert.equal(result.kind, 'edit');
  assert.equal(result.edits.length, 1);
  const [edit] = result.edits;
  assert.equal(edit.before + edit.original + edit.after, source);
  return edit;
}

test('identical or already locally applied code produces no suggestion', () => {
  assert.equal(plan(login, login).kind, 'already-complete');
  assert.equal(plan(validation, validation, login).kind, 'already-complete');
  const statement = '  const name = username.trim();';
  assert.equal(plan(login, login.replace(statement, `${statement}\n${statement}`)).kind, 'already-complete');
});

test('adds only a missing line at the preceding line end', () => {
  const desired = login.replace('  return name;', '  if (!name) return null;\n  return name;');
  const edit = editFor(login, desired);
  assert.equal(edit.original, '');
  assert.equal(edit.insertText, '\n  if (!name) return null;');
  assert.equal(edit.before + edit.insertText + edit.after, desired);
});

test('adds multiple lines without repeating the function, including in CRLF files', () => {
  const source = login.replaceAll('\n', '\r\n');
  const edit = editFor(source, validation, login);
  assert.equal(edit.insertText, '\r\n  if (!name) {\r\n    return null;\r\n  }');
  assert.equal(edit.before + edit.insertText + edit.after, validation.replaceAll('\n', '\r\n'));
});

test('replaces only the differing characters and handles Unicode safely', () => {
  const source = 'const label = "😄";';
  const edit = editFor(source, 'const label = "😎";');
  assert.equal(edit.original, '😄');
  assert.equal(edit.insertText, '😎');
  assert.deepEqual(remainingTeachingEdit(edit, source), { start: 15, end: 17, text: '😎' });
});

test('uses only the remaining prefix after typing and suppresses unrelated or completed edits', () => {
  const edit = editFor(login, validation);
  const typed = '\n  if (!name) {\n    ret';
  const source = edit.before + typed + edit.after;
  const offset = edit.before.length + typed.length;
  assert.deepEqual(remainingTeachingEdit(edit, source), { start: offset, end: offset, text: 'urn null;\n  }' });
  assert.equal(remainingTeachingEdit(edit, validation), undefined);
  assert.equal(remainingTeachingEdit(edit, '// unrelated\n' + source), undefined);
  assert.equal(remainingTeachingEdit(edit, edit.before + '\n  throw' + edit.after), undefined);
  assert.equal(remainingTeachingEdit(edit, login)?.text, edit.insertText);
});

test('accepting with an auto-closed bracket retains exactly one closer', () => {
  const edit = editFor(login, validation);
  for (const typed of ['\n  if ()', '\n  if (!name) {\n    \n  }']) {
    const source = edit.before + typed + edit.after;
    const site = remainingTeachingEdit(edit, source);
    assert.ok(site);
    assert.equal(source.slice(0, site.start) + site.text + source.slice(site.end), validation);
  }
});

test('rejects partial or ambiguous anchors and a new file that has content', () => {
  assert.equal(plan(`${login}\n${login}`, validation, login).kind, 'ambiguous');
  assert.equal(plan(login, 'return null;', 'return name;').kind, 'original-not-found');
  assert.equal(plan(login, 'const ready = true;', '', 'empty_file').kind, 'unsupported-range');
  assert.equal(plan('', 'const ready = true;', '', 'empty_file').kind, 'edit');
  const empty = plan('', 'const ready = true;\nconsole.log(ready);', '', 'empty_file', '\r\n');
  assert.equal(empty.edits[0].insertText, 'const ready = true;\r\nconsole.log(ready);');
});

test('rejects comments and Markdown prose, and unwraps a single code-only fence', () => {
  assert.equal(plan(login, '// TODO\n/* more prose */').kind, 'invalid-ai-data');
  assert.equal(plan(login, login.replace('  return name;', '  // Add a check\n  return name;')).kind, 'invalid-ai-data');
  assert.equal(plan(login, `Here is the answer:\n\`\`\`ts\n${validation}\n\`\`\``).kind, 'invalid-ai-data');
  assert.equal(plan(login, `\`\`\`ts\n${validation}\n\`\`\``).kind, 'edit');
  const prose = editFor(login, login.replace('  return name;', '  handleMissing\n  return name;'));
  assert.equal(isSafeTeachingCode('login.ts', prose), false);
  assert.equal(isSafeTeachingCode('login.ts', editFor(login, login.replace('return name;', 'return name; // Explanation'))), false);
});

test('rejects duplicate declarations outside the supplied context and validates TSX syntax', () => {
  const source = 'function already() {}\n\nconst other = true;';
  const duplicate = editFor(source, 'const other = true;\nfunction already(value) {}', 'const other = true;');
  assert.equal(isSafeTeachingCode('index.js', duplicate), false);
  const component = 'export const App = () => <div>Hello</div>;';
  assert.equal(isSafeTeachingCode('App.tsx', editFor(component, component.replace('Hello', 'Welcome'))), true);
  assert.equal(isSafeTeachingCode('App.tsx', editFor(component, component.replace('</div>', '</span'))), false);
});

const saveLine = '  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));';
const newSaveLine = saveLine.replace('stringify(user)', 'stringify({ ...user, loginAt })');

test('deletes a single character with an empty insertion', () => {
  const source = 'if (!enabled) start();';
  const edit = editFor(source, 'if (enabled) start();');
  assert.equal(edit.original, '!');
  assert.equal(edit.insertText, '');
  assert.deepEqual(remainingTeachingEdit(edit, source), { start: 4, end: 5, text: '' });
  assert.equal(isSafeTeachingCode('index.js', edit), true);
});

test('replaces the exact argument including when the new argument contains the old word', () => {
  const edit = editFor(saveLine, newSaveLine);
  assert.equal(edit.original, 'user');
  assert.equal(edit.insertText, '{ ...user, loginAt }');
  assert.ok(edit.before.endsWith('JSON.stringify('));
  assert.equal(edit.after, '));');
});

test('removes a complete line including its CRLF, and handles a final line without an EOL', () => {
  const source = 'start();\r\nobsolete();\r\nfinish();';
  const result = plan(source, '', 'obsolete();', 'delete');
  assert.equal(result.kind, 'edit');
  assert.equal(result.edits[0].original, 'obsolete();\r\n');
  assert.equal(result.target, 'start();\r\nfinish();');
  const partiallyDeleted = source.replace('obsolete();', 'obso');
  const site = remainingTeachingEdit(result.edits[0], partiallyDeleted);
  assert.equal(partiallyDeleted.slice(site.start, site.end), 'obso\r\n');
  const last = plan(source, '', 'finish();', 'delete');
  assert.equal(last.kind, 'edit');
  assert.equal(last.edits[0].original, '\r\nfinish();');
  assert.equal(last.target, 'start();\r\nobsolete();');
});

test('deletes the later duplicate within a unique contextual block', () => {
  const source = `function store() {\n${saveLine}\n${saveLine}\n}`;
  const desired = `function store() {\n${saveLine}\n}`;
  const edit = editFor(source, desired);
  assert.equal(edit.original, saveLine + '\n');
  assert.ok(edit.before.endsWith(saveLine + '\n'));
  assert.equal(plan(source, '', saveLine, 'delete').kind, 'ambiguous');
});

const duplicated = 'function signIn() {\n  audit();\n  return true;\n}\n\nconst signUp = () => {\n  track();\n  return true;\n};';

test('reports ambiguous candidates and does not trust an exact range or lesson line alone', () => {
  const result = resolve(duplicated, reference('return false;', { original: 'return true;',
    range: { startLine: 8, startColumn: 3, endLine: 8, endColumn: 15 } }), { ...step, line: 8 });
  assert.equal(result.kind, 'ambiguous');
  assert.deepEqual(result.candidates, [
    { line: 3, column: 3, scope: 'signIn' }, { line: 8, column: 3, scope: 'signUp' },
  ]);
});

test('uses the lesson and function scope, nearby source, and verified coordinates', () => {
  const result = resolve(duplicated, reference('return false;', { original: 'return true;', before: '  track();\n  ' }),
    { ...step, title: '调整 signUp 的返回值' });
  assert.equal(result.kind, 'edit');
  assert.equal(result.target, duplicated.replace('track();\n  return true;', 'track();\n  return false;'));
  const repeatedInScope = duplicated.replace('  track();', '  return true;');
  const byRange = resolve(repeatedInScope, reference('return false;', { original: 'return true;', scope: 'signUp',
    range: { startLine: 8, startColumn: 3, endLine: 8, endColumn: 15 } }));
  assert.equal(byRange.kind, 'edit');
  assert.match(byRange.target, /const signUp = \(\) => \{\n  return true;\n  return false;/);
  const conflictingCoordinates = resolve(repeatedInScope, reference('return false;', { original: 'return true;', scope: 'signUp',
    range: { startLine: 8, startColumn: 3, endLine: 8, endColumn: 15 } }), { ...step, line: 7 });
  assert.equal(conflictingCoordinates.kind, 'ambiguous');
  const usingAnchor = resolve(duplicated, reference('return false;', { original: 'return true;', anchor: 'track();' }));
  assert.equal(usingAnchor.target, result.target);
});

test('keeps ambiguous scopes when valid location clues disagree', () => {
  const result = resolve(duplicated, reference('return false;', { original: 'return true;', scope: 'signIn', before: '  track();\n  ' }));
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.candidateCount, 2);
});

test('removes copied context and can match a smaller block after nearby unsaved edits', () => {
  const source = 'let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;\nlet e = 5;';
  const proposed = source.replace('let c = 3;', 'let c = 30;');
  const extra = resolve(source, reference(proposed, { original: 'let c = 3;' }));
  assert.equal(extra.kind, 'edit');
  assert.equal(extra.target, proposed);
  assert.equal(extra.edits[0].insertText, '0');
  const latest = source.replace('let a = 1;', 'let a = 10;');
  const smaller = plan(latest, proposed, source);
  assert.equal(smaller.kind, 'edit');
  assert.equal(smaller.target, latest.replace('let c = 3;', 'let c = 30;'));
  const subexpression = resolve('save(JSON.stringify(user));', reference('JSON.stringify({ ...user })', { original: 'user' }));
  assert.equal(subexpression.target, 'save(JSON.stringify({ ...user }));');
  const noVerifiedContext = plan('let c = 3;\nlog();', proposed, source);
  assert.equal(noVerifiedContext.kind, 'original-not-found');
});

test('distinguishes missing, already applied, unsupported and malformed suggestions', () => {
  assert.equal(resolve(duplicated, reference('return false;', { original: 'return maybe;' })).kind, 'original-not-found');
  const manual = duplicated.replace('track();\n  return true;', 'track();\n  return false;');
  assert.equal(resolve(manual, reference('return false;', { original: 'return true;', scope: 'signUp' })).kind, 'already-complete');
  assert.equal(plan('oldA();\noldB();', 'newA();').kind, 'unsupported-range');
  assert.equal(resolve(duplicated, reference('return false;', { file: 'other.ts', original: 'return true;' })).kind, 'invalid-ai-data');
  assert.equal(resolve(duplicated, reference('return false;', { original: 'return true;', range: { startLine: -1 } })).kind, 'invalid-ai-data');
  assert.equal(resolve(duplicated, { error: 'invalid-json' }).kind, 'invalid-ai-data');
});

test('reconciles replacement, duplicate removal, manual completion, undo and redo against the same plan', () => {
  for (const between of ['', '  audit();\n']) {
    const source = `function store() {\n${saveLine}\n${between}${saveLine}\n}`;
    const intermediate = source.replace(saveLine, newSaveLine);
    const desired = `function store() {\n${newSaveLine}\n${between}}`;
    const result = plan(source, desired);
    assert.equal(result.kind, 'edit');
    assert.equal(result.edits.length, 2);
    assert.equal(result.edits[0].original, 'user');
    assert.equal(result.edits[1].original, saveLine + '\n');
    assert.equal(result.target, desired);
    assert.equal(teachingProgress(result, source).index, 0);
    assert.equal(teachingProgress(result, intermediate).index, 1);
    assert.equal(teachingProgress(result, desired).kind, 'complete');
    assert.equal(teachingProgress(result, intermediate).index, 1);
    assert.equal(teachingProgress(result, desired).kind, 'complete');
  }
});
