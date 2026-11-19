import './mentor_placement_layout.css';

type Guidance = {
  file: string;
  anchor: string;
  line: number;
  title: string;
};

type TutorReader = {
  readProjectFile?: (path: string) => Promise<{content: string}>;
};

let current: Guidance | null = null;
let generation = 0;

function makeNode<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

async function showPlacement(): Promise<void> {
  const view = document.getElementById('handson-mode-view');
  const step = view?.querySelector<HTMLElement>('.handson-step');
  if (!view || !step || step.hidden || !current) return;
  const guidance = current;
  const id = ++generation;
  let card = step.querySelector<HTMLElement>('.mentor-placement-card');
  if (!card) {
    card = makeNode('section', 'mentor-placement-card');
    const heading = makeNode('div', 'mentor-placement-heading');
    heading.append(makeNode('span', 'mentor-placement-kicker', '02 · 修改位置'), makeNode('strong', 'mentor-placement-title', '把代码写在哪里'));
    const file = makeNode('div', 'mentor-placement-file');
    const action = makeNode('div', 'mentor-placement-action');
    const explanation = makeNode('p', 'mentor-placement-notice');
    const excerpt = makeNode('details', 'mentor-placement-context');
    excerpt.append(makeNode('summary', '', '查看目标位置附近的现有代码'), makeNode('pre', 'mentor-placement-snippet'));
    const jump = makeNode('button', 'mentor-placement-jump', '定位到编辑器中的修改位置');
    jump.type = 'button';
    jump.addEventListener('click', () => {
      if (!current) return;
      window.dispatchEvent(new CustomEvent('code-tutor-handson-guide', {
        detail: { file: current.file, anchor: current.anchor, line: current.line, task: current.title },
      }));
    });
    card.append(heading, file, action, explanation, jump, excerpt);
    const reference = step.querySelector('.handson-reference');
    const instruction = step.querySelector('.handson-instruction');
    if (instruction) instruction.insertAdjacentElement('afterend', card);
    else if (reference) reference.insertAdjacentElement('beforebegin', card);
    else step.prepend(card);
  }
  setText(card.querySelector('.mentor-placement-file')!, guidance.file);
  setText(card.querySelector('.mentor-placement-action')!, '正在核对当前文件中的准确位置…');
  setText(card.querySelector('.mentor-placement-notice')!, '请在定位位置附近修改已有逻辑。参考代码是学习示例，不应直接覆盖整个文件。');
  const excerpt = card.querySelector<HTMLDetailsElement>('.mentor-placement-context');
  if (excerpt) excerpt.hidden = true;
  const api = (window as unknown as {tutorIde?: TutorReader}).tutorIde;
  try {
    if (!api?.readProjectFile) throw new Error('无法读取文件');
    const result = await api.readProjectFile(guidance.file);
    if (id !== generation || current !== guidance) return;
    const contents = result.content;
    const lines = contents.split(/\r?\n/);
    const anchor = guidance.anchor.trim();
    const offset = anchor ? contents.indexOf(anchor) : -1;
    const exact = offset >= 0;
    const line = exact
      ? contents.slice(0, offset).split(/\r?\n/).length
      : Math.max(1, Math.min(lines.length, guidance.line || 1));
    const action = exact
      ? `第 ${line} 行附近 · 已与现有代码匹配`
      : `建议从第 ${line} 行附近开始 · 尚未找到精确匹配`;
    setText(card.querySelector('.mentor-placement-action')!, action);
    setText(card.querySelector('.mentor-placement-notice')!, exact
      ? '先找到下方显示的现有代码，再按任务要求修改相关逻辑。参考答案可能只是一部分代码，不要整段覆盖文件。'
      : 'AI 给出的是建议位置，不是确认过的替换范围。请先查看现有函数，确定后再手动编辑。');
    if (excerpt) {
      const first = Math.max(0, line - 4);
      const last = Math.min(lines.length, line + 4);
      const preview = lines.slice(first, last).map((text, index) => `${String(first + index + 1).padStart(4, ' ')}  ${text}`).join('\n');
      const pre = excerpt.querySelector('pre');
      if (pre) setText(pre, preview);
      excerpt.hidden = false;
    }
  } catch {
    if (id !== generation || current !== guidance) return;
    setText(card.querySelector('.mentor-placement-action')!, '文件尚未找到，先确认文件是否需要创建');
    setText(card.querySelector('.mentor-placement-notice')!, '当前无法确认具体行号。请不要照着参考代码覆盖其他文件；先创建或打开任务指定文件。');
  }
}

function initialize(): void {
  const panel = document.getElementById('mentor-course-panel');
  if (!panel || panel.dataset.mentorPlacementInitialized === 'yes') return;
  panel.dataset.mentorPlacementInitialized = 'yes';
  const watch = new MutationObserver(() => {
    const view = panel.querySelector<HTMLElement>('#handson-mode-view');
    const step = view?.querySelector<HTMLElement>('.handson-step');
    if (!current || !step || step.hidden || step.querySelector('.mentor-placement-card')) return;
    void showPlacement();
  });
  watch.observe(panel, {childList: true, subtree: true});
}

window.addEventListener('code-tutor-handson-placement-step', (event: Event) => {
  const data = (event as CustomEvent<Guidance>).detail;
  if (!data?.file) return;
  current = {
    file: data.file,
    anchor: typeof data.anchor === 'string' ? data.anchor : '',
    line: Number.isFinite(data.line) ? data.line : 1,
    title: typeof data.title === 'string' ? data.title : '',
  };
  void showPlacement();
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once: true});
else initialize();
