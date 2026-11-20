const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { join } = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');

app.setPath('userData', join(process.argv[3], 'profile'));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({ width: 1024, height: 720, backgroundColor: '#161a22' });
  const contents = window.webContents;
  const diagnosticLogs = [];
  contents.on('console-message', event => {
    if (event.message.includes('[teaching-completion]')) diagnosticLogs.push(event.message);
  });
  const evaluate = code => contents.executeJavaScript(`window.teachingTest.${code}`, true);
  const state = () => evaluate('state()');
  const click = selector => evaluate(`click(${JSON.stringify(selector)})`);
  const submit = value => evaluate(`submit(${JSON.stringify(value)})`);

  async function until(message, condition) {
    const deadline = Date.now() + 5000;
    do {
      const result = await state();
      if (condition(result)) return result;
      await delay(35);
    } while (Date.now() < deadline);
    assert.fail(`${message}\n${JSON.stringify(await state(), null, 2)}`);
  }

  async function key(keyCode, modifiers = [], character) {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (character) contents.sendInputEvent({ type: 'char', keyCode: character });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await delay(75);
  }

  function clickAt(position) {
    for (const type of ['mouseDown', 'mouseUp']) {
      contents.sendInputEvent({ type, ...position, button: 'left', clickCount: 1 });
    }
  }

  async function clickCode(line, column) {
    clickAt(await evaluate(`point(${line}, ${column})`));
  }

  await window.loadFile(process.argv[2]);
  window.focus();
  await click('#inline-copilot-launch');
  await submit('验证登录');
  await until('the first step asks before writing', s => s.yes && s.no && s.bubble.includes('这一步你会写吗？'));
  const initial = await evaluate('initial');
  const desired = await evaluate('withValidation');
  const originalPosition = (await state()).position;
  await click('[data-no]');
  const ready = await until('the first hint is stored', s => s.restore && s.bubble.includes('已准备好提示'));
  assert.deepEqual(ready.position, originalPosition);
  assert.equal(ready.text, initial);
  assert.equal(ready.lastAnchor, initial);

  await click('[data-restore]');
  const displayed = await until('Monaco renders the missing multiline code', s => s.ghost.includes('return') && s.ghost.includes('null'));
  assert.equal(displayed.text, initial);
  assert.doesNotMatch(displayed.ghost, /function|const name/);
  assert.equal(displayed.references, 1);

  await clickCode(1, 3);
  await until('clicking away hides the ghost while retaining its state', s => s.position.lineNumber === 1 && !s.ghost && s.restore);
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  await key('Tab');
  await until('Tab away from the site retains normal indentation', s => s.text === initial.slice(0, 2) + '  ' + initial.slice(2));
  await key('Z', [modifier]);
  await until('regular indentation can be undone', s => s.text === initial);

  await clickCode(displayed.position.lineNumber, displayed.position.column);
  await until('clicking the original site re-triggers Monaco', s => s.ghost.includes('null'));
  clickAt(await evaluate('outsidePoint()'));
  await until('blur leaves the stored suggestion intact', s => !s.focused && !s.ghost && s.restore);
  await evaluate('focus()');
  await until('focus at the original site restores the ghost', s => s.focused && s.ghost.includes('null'));

  await evaluate(`switchFile('other.ts')`);
  await until('the suggestion never appears in another file', s => s.text === 'const other = true;' && !s.ghost);
  await evaluate(`switchFile('login.ts')`);
  await click('[data-restore]');
  await until('explicit restore works after switching files', s => s.ghost.includes('null') && s.references === 1);

  await key('Enter', [], '\r');
  await key('I', [], 'i');
  const typed = await until('typing leaves only the remaining code in ghost text', s => s.text.includes('\n  i\n') && s.ghost.includes('null'));
  assert.doesNotMatch(typed.ghost, /\bif\b/);
  await key('Backspace');
  await until('backspace is handled normally', s => s.text.includes('\n  \n'));
  await key('I', [], 'i');
  await until('the partial hint is drawn again', s => s.text.includes('\n  i\n') && s.ghost.includes('null'));
  await key('Tab');
  await until('native Tab accepts only the remaining code', s => s.text === desired && !s.ghost);
  await key('Z', [modifier]);
  await until('undo restores the manually typed prefix', s => s.text === typed.text);
  await key(process.platform === 'win32' ? 'Y' : 'Z', process.platform === 'win32' ? [modifier] : [modifier, 'shift']);
  await until('redo restores the accepted code', s => s.text === desired);

  await click('[data-check]');
  const passed = await until('verification unlocks the next step', s => s.next);
  assert.equal(passed.verified, desired);
  await click('[data-next]');
  await until('the next step asks again', s => s.yes && s.no && s.bubble.includes('任务 2') && s.bubble.includes('这一步你会写吗？'));
  await click('[data-no]');
  await until('a replacement is ready', s => s.restore && s.bubble.includes('已准备好提示'));
  await click('[data-restore]');
  const replacementHint = await until('the exact old argument is struck out and the replacement is ghost text',
    s => s.removed === 'user' && s.strike && s.canAccept && s.ghost.replaceAll('\u00a0', ' ').includes('{ ...user, loginAt }'));
  assert.match(replacementHint.bubble, /1 \/ 2.*替换/);
  assert.doesNotMatch(replacementHint.ghost, /JSON\.stringify/);
  await key('Escape');
  await until('Escape hides the ghost and deletion marks without clearing the suggestion', s => !s.canAccept && !s.removed && s.restore);
  await evaluate('focus()');
  assert.equal((await state()).canAccept, false);
  await click('[data-restore]');
  await until('replacement can be restored after Escape', s => s.removed === 'user' && s.canAccept && s.references === 2);
  await clickCode(replacementHint.position.lineNumber, 3);
  await until('moving on the same line withdraws the replacement', s => !s.canAccept && !s.removed && s.restore && s.text === desired);
  await click('[data-restore]');
  await until('replacement is restorable with the cached answer', s => s.removed === 'user' && s.canAccept && s.references === 2);
  await key('Tab');
  const replacement = await evaluate('withReplacement');
  const duplicate = await evaluate('saveLine');
  const deletion = await until('Tab applies the replacement only and shows the pending duplicate deletion',
    s => s.text === replacement && s.wholeLine && s.removed === duplicate && s.canAccept && /2 \/ 2.*删除/.test(s.bubble));
  assert.equal(deletion.references, 2);
  assert.doesNotMatch(deletion.bubble, /全部完成/);
  await click('[data-check]');
  assert.equal((await state()).next, false);
  await click('[data-restore]');
  await until('the pending whole-line deletion still renders after check', s => s.wholeLine && s.canAccept);
  await key('Tab');
  const final = await evaluate('withoutDuplicate');
  await until('Tab removes the whole duplicate line', s => s.text === final && !s.removed && s.bubble.includes('全部完成'));
  await key('Z', [modifier]);
  await until('one undo restores only the deleted duplicate line', s => s.text === replacement && /2 \/ 2.*删除/.test(s.bubble));
  await click('[data-restore]');
  await until('the undone deletion can be displayed again', s => s.wholeLine && s.canAccept);
  await key('K', [modifier, 'shift']);
  await until('manual line deletion completes the same plan without a repeated suggestion',
    s => s.text === final && !s.canAccept && !s.removed && s.bubble.includes('全部完成'));
  await click('[data-check]');
  await until('the replacement can be checked', s => s.next);
  await click('[data-next]');
  await until('a later step still offers both choices', s => s.yes && s.no && s.bubble.includes('任务 3'));
  await click('[data-no]');
  await until('single-character deletion is ready', s => s.restore && s.bubble.includes('删除'));
  await click('[data-restore]');
  await until('only the exact character is struck out', s => s.removed === '!' && s.strike && !s.wholeLine && s.canAccept);
  await key('Tab');
  const charDeleted = await evaluate('withoutNegation');
  await until('Tab accepts the single-character deletion', s => s.text === charDeleted && s.bubble.includes('全部完成'));
  await key('Z', [modifier]);
  await until('undo restores the deleted character', s => s.text === final && s.restore);
  await click('[data-restore]');
  await until('the restored character is marked again', s => s.removed === '!' && s.canAccept);
  await key('Delete');
  await until('manually deleting the character finishes without reoffering it', s => s.text === charDeleted && !s.canAccept && !s.removed);
  await click('[data-check]');
  await until('the manually edited code can be checked', s => s.next);
  await click('[data-next]');
  await until('the next lesson offers self-writing', s => s.yes && s.no && s.bubble.includes('任务 4'));
  await click('[data-yes]');
  await until('the self-writing branch hides both buttons', s => !s.yes && !s.no && !s.restore && s.bubble.includes('试着写'));

  await click('[data-check]');
  await until('the self-written step is verified', s => s.next);
  await click('[data-next]');
  await until('the relocation lesson is ready', s => s.no && s.bubble.includes('任务 5'));
  await click('[data-no]');
  const held = await until('the initial reference is held while the editor remains editable', s => s.holdingReference);
  await clickCode(1, 1);
  await key('Space', [], ' ');
  const changed = await until('changing the buffer while the first request is in flight succeeds', s => s.text !== held.text);
  await evaluate('releaseReference()');
  const relocated = await until('a single retry uses the latest unsaved buffer and locates the edit',
    s => s.references === held.references + 1 && s.restore && s.bubble.includes('已准备好提示'));
  assert.deepEqual(relocated.relocationReasons, ['original-not-found']);
  assert.deepEqual(relocated.relocationBuffers, [changed.text]);
  assert.ok(diagnosticLogs.some(message => message.includes('original-not-found')));
  await click('[data-restore]');
  await until('the relocated insertion is rendered natively', s => s.ghost.includes('toUpperCase') && s.canAccept);
  await key('Tab');
  await until('Tab changes only the newly verified range', s => s.text === changed.text.replace('return name;', 'return name.toUpperCase();'));
  await click('[data-check]');
  await until('verification still follows the relocated suggestion', s => s.next);
  await click('[data-next]');
  const beforeAmbiguous = await until('the ambiguous lesson appears', s => s.no && s.bubble.includes('任务 6'));
  await click('[data-no]');
  const ambiguous = await until('one retry leaves both candidates visible and no edit available',
    s => s.references === beforeAmbiguous.references + 2 && s.bubble.includes('找到多个候选位置'));
  assert.match(ambiguous.bubble, /候选位置.*\d+:3（firstCheck）.*\d+:3（secondCheck）/);
  assert.equal(ambiguous.canAccept, false);
  assert.equal(ambiguous.text, beforeAmbiguous.text);
  assert.deepEqual(ambiguous.relocationReasons, ['original-not-found', 'ambiguous']);
  assert.equal(diagnosticLogs.filter(message => message.includes('ambiguous')).length, 2);
  console.log('Electron/Monaco editor tests passed.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
