import assert from 'node:assert/strict';
import test from 'node:test';
import { isProjectPath, isSensitivePath, isTeachingStep, isTeachingVerification } from '../shared/teaching/session.ts';
import { reactTodoLessons } from '../shared/teaching/react_todo_course.ts';
import { isClearCommand } from '../shared/core/terminal.ts';
import { decodeEditorEvent, maxEditorLength } from '../mobile/src/editor/protocol.ts';

test('teaching steps accept safe project-relative paths and reject malformed data', () => {
  const step = { file: 'src/待办.tsx', title: '写组件', instruction: '返回一个 JSX 标题', line: 1 };
  assert.equal(isTeachingStep(step), true);
  for (const path of ['../src/test.ts', '/src/App.tsx', 'C:\\src\\App.tsx', 'src//index.ts', 'src/./test.ts', 'src/\u0000file']) {
    assert.equal(isProjectPath(path), false);
    assert.equal(isTeachingStep({ ...step, file: path }), false);
  }
  assert.equal(isTeachingStep({ ...step, line: 0 }), false);
  assert.equal(isTeachingStep({ ...step, title: '' }), false);
  assert.equal(isTeachingVerification({ passed: 'true', feedback: 'incorrect' }), false);
  assert.equal(isTeachingVerification({ passed: false, feedback: '需要实现组件' }), true);
});

test('sensitive paths are filtered independently from ordinary project paths', () => {
  for (const path of ['.env.local', 'config/token.key', 'app/release.jks', 'nested/.npmrc', 'config/database-secret.json']) {
    assert.equal(isSensitivePath(path), true);
  }
  assert.equal(isSensitivePath('src/App.tsx'), false);
});

test('the shared React course checks actual source', () => {
  const component = reactTodoLessons.find(item => item.id === 'component');
  const source = 'function App() { return <h1>Todo List</h1>; } export default App;';
  assert.ok(component.checks.every(check => check.test(source)));
  assert.ok(component.checks.some(check => !check.test('function App() {}')));
});

test('the editor bridge rejects unknown commands and invalid selection bounds', () => {
  const event = { type: 'change', id: 'src/App.tsx', text: '😀a', selection: { from: 0, to: 2 } };
  assert.deepEqual(decodeEditorEvent(JSON.stringify(event)), event);
  assert.equal(decodeEditorEvent(JSON.stringify({ ...event, type: 'run', command: 'node' })), undefined);
  assert.equal(decodeEditorEvent(JSON.stringify({ ...event, selection: { from: 0, to: 4 } })), undefined);
  assert.equal(decodeEditorEvent(JSON.stringify({ ...event, text: ' '.repeat(maxEditorLength + 1) })), undefined);
  assert.equal(decodeEditorEvent('abc'), undefined);
});

test('screen clearing never expands terminal commands or arguments', () => {
  assert.equal(isClearCommand(' Clear-Host '), true);
  assert.equal(isClearCommand('clear && date'), false);
});
