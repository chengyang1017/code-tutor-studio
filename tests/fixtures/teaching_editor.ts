import { EditorController } from '../../src/editor/editor_controller';
import { installInlineCopilotTutor } from '../../src/mentor/inline_copilot_tutor';

const file = 'login.ts';
const saveLine = '  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));';
const auth = `function store(user: unknown, loginAt: number) {\n${saveLine}\n  audit();\n${saveLine}\n}`;
const checks = '\n\nfunction firstCheck() {\n  return true;\n}\n\nfunction secondCheck() {\n  return true;\n}';
const initial = 'function login(username: string) {\n  const name = username.trim();\n  return name;\n}\n\n' + auth + checks;
const withValidation = initial.replace('  return name;', '  if (!name) {\n    return null;\n  }\n  return name;');
const withReplacement = withValidation.replace('stringify(user)', 'stringify({ ...user, loginAt })');
const withoutDuplicate = withReplacement.replace('\n' + saveLine, '');
const withoutNegation = withoutDuplicate.replace('!name', 'name');
let steps = 0;
let references = 0;
let verified: string | undefined;
let lastAnchor: string | undefined;
let releaseReference: (() => void) | undefined;
let relocationBuffers: string[] = [];
let relocationReasons: string[] = [];

Object.assign(window, {
  tutorIde: {
    restoreProject: async () => ({ rootPath: 'fixture', files: [file, 'other.ts'] }),
    handsonStep: async ({ mode, buffer, relocation }: { mode: string; buffer: { content: string }; relocation?: { kind: string } }) => {
      if (mode === 'next') return { file, title: `任务 ${++steps}`, instruction: '修改登录校验。' };
      if (mode === 'verify') {
        verified = buffer.content;
        return { passed: true, feedback: '检查通过。' };
      }
      references++;
      lastAnchor = buffer.content;
      if (relocation) {
        relocationBuffers.push(buffer.content);
        relocationReasons.push(relocation.kind);
      }
      if (steps === 5) {
        if (!relocation) {
          await new Promise<void>(resolve => { releaseReference = resolve; });
          releaseReference = undefined;
          return { example: 'return name.toUpperCase();', placement: { file, action: 'replace', original: 'return staleValue;' } };
        }
        return { example: 'return name.toUpperCase();', placement: { file, action: 'replace', original: 'return name;', scope: 'login' } };
      }
      if (steps === 6) {
        return { example: 'return false;', placement: { file, action: 'replace', original: 'return true;' } };
      }
      return { example: [withValidation, withoutDuplicate, withoutNegation][steps - 1],
        placement: { file, action: 'replace', anchor: buffer.content } };
    },
  },
});

const element = document.querySelector<HTMLElement>('#editor')!;
const controller = new EditorController(element, [
  { path: file, language: 'typescript', content: initial },
  { path: 'other.ts', language: 'typescript', content: 'const other = true;' },
]);
const editor = controller.editor;
installInlineCopilotTutor(controller, async path => controller.openFile(path));

const button = (name: string) => document.querySelector<HTMLButtonElement>(name)!;
const visible = (name: string) => !!button(name)?.getClientRects().length;
Object.assign(window, {
  teachingTest: {
    initial, withValidation, withReplacement, withoutDuplicate, withoutNegation, saveLine,
    click: (selector: string) => button(selector).click(),
    submit: (value: string) => {
      document.querySelector<HTMLInputElement>('[data-input]')!.value = value;
      document.querySelector<HTMLFormElement>('[data-form]')!.requestSubmit();
    },
    focus: () => editor.focus(),
    releaseReference: () => releaseReference?.(),
    outsidePoint: () => {
      const rect = button('#outside').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    },
    switchFile: (path: string) => controller.openFile(path),
    point: (lineNumber: number, column: number) => {
      const position = editor.getScrolledVisiblePosition({ lineNumber, column })!;
      const area = element.getBoundingClientRect();
      return { x: Math.round(area.left + position.left), y: Math.round(area.top + position.top + position.height / 2) };
    },
    state: () => ({
      text: controller.getCurrentContent(), position: editor.getPosition(), focused: editor.hasTextFocus(),
      focusedElement: document.activeElement?.outerHTML.slice(0, 150),
      ghost: Array.from(element.querySelectorAll('.ghost-text, .ghost-text-decoration')).map(node => node.textContent).join('\n'),
      canAccept: editor.getAction('editor.action.inlineSuggest.commit')?.isSupported(),
      removed: Array.from(element.querySelectorAll('.teaching-delete-text')).map(node => node.textContent).join('').replaceAll('\u00a0', ' '),
      strike: Array.from(element.querySelectorAll('.teaching-delete-text'))
        .every(node => getComputedStyle(node).textDecorationLine.includes('line-through')),
      wholeLine: !!element.querySelector('.teaching-delete-line-number'),
      bubble: document.querySelector('[data-bubble]')!.textContent,
      yes: visible('[data-yes]'), no: visible('[data-no]'), restore: visible('[data-restore]'), next: visible('[data-next]'),
      references, verified, lastAnchor,
      holdingReference: Boolean(releaseReference), relocationBuffers, relocationReasons,
    }),
  },
});
