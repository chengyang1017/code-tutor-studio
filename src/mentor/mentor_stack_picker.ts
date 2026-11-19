import './mentor_stack_picker.css';

type Stack = 'react-ts' | 'react' | 'vue-ts' | 'vue' | 'flutter';

const STACKS: ReadonlyArray<{ id: Stack; label: string; template?: string }> = [
  { id: 'react-ts', label: 'React + TypeScript', template: 'react-ts' },
  { id: 'react', label: 'React + JavaScript', template: 'react' },
  { id: 'vue-ts', label: 'Vue + TypeScript', template: 'vue-ts' },
  { id: 'vue', label: 'Vue + JavaScript', template: 'vue' },
  { id: 'flutter', label: 'Flutter + Dart' },
];

function install(): boolean {
  const panel = document.getElementById('mentor-course-panel');
  const select = panel?.querySelector<HTMLSelectElement>('#mentor-course-select');
  const instruction = panel?.querySelector<HTMLElement>('[data-mentor-instruction]');
  const body = panel?.querySelector<HTMLElement>('.mentor-course-body');
  const progress = panel?.querySelector<HTMLElement>('[data-mentor-progress]');
  if (!panel || !select || !instruction || !body || !progress) return false;
  if (panel.dataset.stackPickerInstalled === 'true') return true;
  panel.dataset.stackPickerInstalled = 'true';

  const label = panel.querySelector<HTMLLabelElement>('label[for="mentor-course-select"]');
  if (label) label.textContent = '\u9009\u62e9\u6280\u672f\u7ec4\u5408';
  select.replaceChildren(...STACKS.map((stack) => {
    const option = document.createElement('option');
    option.value = stack.id;
    option.textContent = stack.label;
    return option;
  }));
  select.value = 'react-ts';

  const controls = document.createElement('div');
  controls.className = 'mentor-stack-fields';
  controls.innerHTML = `
    <label for="mentor-project-name">\u9879\u76ee\u540d\u79f0</label>
    <input id="mentor-project-name" type="text" value="todo-lesson"
      autocomplete="off" spellcheck="false" maxlength="60" />
    <p class="mentor-stack-notice" data-mentor-stack-notice role="status"></p>
  `;
  const input = controls.querySelector<HTMLInputElement>('input')!;
  const notice = controls.querySelector<HTMLElement>('[data-mentor-stack-notice]')!;
  select.insertAdjacentElement('afterend', controls);

  const title = panel.querySelector<HTMLElement>('[data-mentor-title]');
  const objective = panel.querySelector<HTMLElement>('[data-mentor-objective]');
  const verify = panel.querySelector<HTMLButtonElement>('[data-mentor-verify]');
  const next = panel.querySelector<HTMLButtonElement>('[data-mentor-next]');
  const message = panel.querySelector<HTMLElement>('[data-mentor-message]');
  let scheduled = false;

  function setupStep(): boolean {
    // The existing lesson engine is unchanged. Only step 1 is scaffold setup.
    return /^\u7b2c\s*1\s*\//.test(progress!.textContent?.trim() ?? '');
  }

  function commandsFor(stack: Stack, name: string): string[] {
    if (stack === 'flutter') return [
      `flutter create --project-name ${name} ${name}`,
      `cd ${name}`,
    ];
    const template = STACKS.find((item) => item.id === stack)?.template ?? 'react-ts';
    return [
      `npm create vite@latest ${name} -- --template ${template}`,
      `cd ${name}`,
      'npm install',
    ];
  }

  function copyRow(command: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mentor-command-row';
    row.dataset.mentorStackCommand = command;
    const code = document.createElement('code');
    code.textContent = command;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'mentor-command-copy';
    copy.textContent = '\u590d\u5236';
    copy.title = '\u53ea\u590d\u5236\u5f53\u524d\u547d\u4ee4';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = '\u5df2\u590d\u5236';
        window.setTimeout(() => { copy.textContent = '\u590d\u5236'; }, 1400);
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });
    row.append(code, copy);
    return row;
  }

  function refresh(): void {
    const onSetup = setupStep();
    controls.hidden = !onSetup;
    // Hide technology selector outside scaffold setup; other course steps
    // are still React + TypeScript Todo lessons.
    select!.hidden = !onSetup;
    if (label) label.hidden = !onSetup;
    if (!onSetup) return;

    const stack = select!.value as Stack;
    const name = input.value.trim();
    const valid = stack === 'flutter'
      ? /^[a-z][a-z0-9_]{0,59}$/.test(name)
      : /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(name);
    const isReactTs = stack === 'react-ts';
    const stackLabel = STACKS.find((item) => item.id === stack)?.label ?? 'React + TypeScript';
    if (title) title.textContent = `\u521b\u5efa ${stackLabel} \u9879\u76ee`;
    if (objective) objective.textContent = '\u4f7f\u7528\u5b98\u65b9\u5de5\u5177\u521b\u5efa\u9879\u76ee\uff0c\u7136\u540e\u5b89\u88c5\u6240\u9700\u4f9d\u8d56\u3002';
    if (!valid) {
      notice.textContent = stack === 'flutter'
        ? '\u0046\u006c\u0075\u0074\u0074\u0065\u0072 \u9879\u76ee\u540d\u79f0\u53ea\u5141\u8bb8\u5c0f\u5199\u5b57\u6bcd\u3001\u6570\u5b57\u548c\u4e0b\u5212\u7ebf\uff0c\u5e76\u4ee5\u5b57\u6bcd\u5f00\u5934\u3002'
        : '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u9879\u76ee\u6587\u4ef6\u5939\u540d\u79f0\u3002';
    } else {
      notice.textContent = isReactTs ? '' : '\u540e\u7eed Todo \u6e90\u7801\u8bfe\u7a0b\u76ee\u524d\u4ec5\u652f\u6301 React + TypeScript\uff1b\u5176\u4ed6\u7ec4\u5408\u6682\u53ea\u63d0\u4f9b\u5b98\u65b9\u521b\u5efa\u6307\u4ee4\u3002';
    }
    if (verify) verify.disabled = !valid || !isReactTs;
    if (next && !isReactTs) next.disabled = true;
    if (!valid && message) message.textContent = '\u8bf7\u5148\u8f93\u5165\u6709\u6548\u9879\u76ee\u540d\u79f0\u3002';

    const commands = valid ? commandsFor(stack, name) : [];
    // Detect when the original lesson renderer has overwritten our commands.
    const existing = Array.from(instruction!.querySelectorAll<HTMLElement>('[data-mentor-stack-command]'));
    const same = existing.length === commands.length &&
      existing.every((row, index) => row.dataset.mentorStackCommand === commands[index]) &&
      instruction!.children.length === commands.length;
    if (same) return;
    instruction!.classList.add('mentor-command-list');
    instruction!.replaceChildren(...commands.map(copyRow));
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => { scheduled = false; refresh(); });
  }
  select.addEventListener('change', schedule);
  input.addEventListener('input', schedule);
  // Existing mentor panel re-renders when the lesson changes; reapply current
  // scaffold options only when necessary, without an observer feedback loop.
  new MutationObserver(schedule).observe(instruction, { childList: true });
  new MutationObserver(schedule).observe(progress, { childList: true, characterData: true, subtree: true });
  schedule();
  return true;
}

function bootstrap(): void {
  if (install()) return;
  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else bootstrap();
