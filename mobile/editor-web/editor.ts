import { basicSetup } from 'codemirror';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { dart } from '@codemirror/legacy-modes/mode/clike';
import { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { maxEditorLength } from '../src/editor/protocol';
import type { Change, EditorCommand, EditorEvent, Selection } from '../src/editor/protocol';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void };
    codeTutorEditor: { receive(command: EditorCommand): void };
  }
}

const send = (event: EditorEvent) => window.ReactNativeWebView?.postMessage(JSON.stringify(event));
const highlight = StateEffect.define<Selection | null>();
const wrap = new Compartment();
const marked = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (!effect.is(highlight)) continue;
      const range = effect.value;
      value = range ? Decoration.set(range.from === range.to
        ? [Decoration.line({ class: 'tutor-line' }).range(transaction.state.doc.lineAt(range.from).from)]
        : [Decoration.mark({ class: 'tutor-range' }).range(range.from, range.to)]) : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

function language(path: string) {
  if (/\.[cm]?tsx?$/i.test(path)) return javascript({ typescript: true, jsx: /tsx$/i.test(path) });
  if (/\.[cm]?jsx?$/i.test(path)) return javascript({ jsx: true });
  if (/\.json$/i.test(path)) return json();
  if (/\.html?$/i.test(path)) return html();
  if (/\.css$/i.test(path)) return css();
  if (/\.py$/i.test(path)) return python();
  if (/\.dart$/i.test(path)) return StreamLanguage.define(dart);
  return [];
}

const views = new Map<string, EditorState>();
const positions = new Map<string, { x: number; y: number }>();
let id = '';
const view = new EditorView({ parent: document.getElementById('editor')! });
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#111a28', color: '#e1e9f5', fontSize: '15px' },
  '.cm-scroller': { fontFamily: 'monospace' },
  '.cm-gutters': { backgroundColor: '#151f30', color: '#a8b7cc', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#29364a' },
  '.cm-activeLineGutter': { backgroundColor: '#29364a' },
  '.tutor-line, .tutor-range': { backgroundColor: '#345950', color: '#fff' },
}, { dark: true });
const codeColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: '#c9acf5' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName), tags.labelName], color: '#9bc3ff' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#a2e3b7' },
  { tag: [tags.number, tags.bool, tags.null], color: '#ffbd9a' },
  { tag: [tags.comment, tags.meta], color: '#9caec6', fontStyle: 'italic' },
  { tag: [tags.tagName, tags.typeName, tags.className, tags.attributeName], color: '#8ed8e9' },
  { tag: [tags.operator, tags.punctuation], color: '#d7e1ef' },
  { tag: tags.invalid, color: '#ffa5af', textDecoration: 'underline' },
]);

function selection() {
  const { from, to } = view.state.selection.main;
  return { from, to };
}

function create(text: string, file: string, readOnly: boolean) {
  return EditorState.create({ doc: text, extensions: [
    keymap.of([{ key: 'Mod-s', run: () => { send({ type: 'save', id }); return true; } }]),
    basicSetup, language(file), theme, syntaxHighlighting(codeColors), marked, wrap.of([]), lintGutter(),
    /\.(json|css|html?|py)$/i.test(file) ? linter(editor => {
      const problems: Diagnostic[] = [];
      syntaxTree(editor.state).iterate({ enter(node) {
        if (problems.length >= 100) return false;
        if (node.type.isError) problems.push({ from: node.from, to: node.to, severity: 'error', message: '此处存在语法错误' });
      } });
      return problems;
    }) : [],
    EditorState.tabSize.of(2), EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({ 'aria-label': '源代码编辑器' }),
    EditorState.transactionFilter.of(transaction => {
      if (transaction.newDoc.length <= maxEditorLength) return transaction;
      send({ type: 'limit', id });
      return [];
    }),
    EditorView.updateListener.of(update => {
      views.set(id, update.state);
      if (update.docChanged) {
        const changes: Change[] = [];
        update.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, text: insert.toString() }));
        if (changes.length <= 128) send({ type: 'delta', id, beforeLength: update.startState.doc.length, changes, selection: selection() });
        else send({ type: 'change', id, text: update.state.doc.toString(), selection: selection() });
      }
      else if (update.selectionSet) send({ type: 'selection', id, selection: selection() });
    }),
  ] });
}

window.codeTutorEditor = {
  receive(command) {
    if (command.type === 'snapshot') {
      const state = views.get(command.id);
      if (state) {
        const { from, to } = state.selection.main;
        send({ type: 'change', id: command.id, text: state.doc.toString(), selection: { from, to } });
      }
      return;
    }
    if (command.type === 'forget') {
      views.delete(command.id);
      positions.delete(command.id);
      if (id === command.id) {
        id = '';
        view.setState(EditorState.create({ extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), theme] }));
      }
      return;
    }
    if (command.type === 'open') {
      if (id && id !== command.id) positions.set(id, { x: view.scrollDOM.scrollLeft, y: view.scrollDOM.scrollTop });
      id = command.id;
      const state = views.get(id);
      view.setState(state?.doc.toString() === command.text && state.readOnly === command.readOnly ? state : create(command.text, id, command.readOnly));
      views.set(id, view.state);
      const position = positions.get(id);
      if (position) requestAnimationFrame(() => {
        if (id === command.id) view.scrollDOM.scrollTo(position.x, position.y);
      });
      send({ type: 'selection', id, selection: selection() });
      return;
    }
    if (id !== command.id) return;
    switch (command.type) {
      case 'replace': {
        if (view.state.readOnly) return;
        const current = view.state.doc.toString();
        if (current !== command.before) { send({ type: 'stale', id }); return; }
        let start = 0;
        let tail = 0;
        while (start < current.length && start < command.text.length && current[start] === command.text[start]) start++;
        while (tail < current.length - start && tail < command.text.length - start &&
            current[current.length - 1 - tail] === command.text[command.text.length - 1 - tail]) tail++;
        view.dispatch({
          changes: { from: start, to: current.length - tail, insert: command.text.slice(start, command.text.length - tail) },
          annotations: Transaction.userEvent.of('input.tutor'),
        });
        break;
      }
      case 'mark': {
        const range = command.range;
        if (range && (range.from < 0 || range.from > range.to || range.to > view.state.doc.length)) return;
        const effects: StateEffect<unknown>[] = [highlight.of(range)];
        if (range && command.reveal) effects.push(EditorView.scrollIntoView(range.from, { y: 'center' }));
        view.dispatch({ effects });
        break;
      }
      case 'diagnostics': view.dispatch(setDiagnostics(view.state, command.diagnostics)); break;
      case 'wrap': view.dispatch({ effects: wrap.reconfigure(command.enabled ? EditorView.lineWrapping : []) }); break;
      case 'undo': undo(view); break;
      case 'redo': redo(view); break;
    }
  },
};
send({ type: 'ready' });

