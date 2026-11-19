import './handson_mode.css';

type Step = { file: string; title: string; instruction: string; example: string; explanation: string; anchor?: string; line?: number } ;
type Verify = { passed: boolean; feedback: string };
type TutorApi = { restoreProject: () => Promise<{rootPath:string;files:string[]} | null>; handsonStep: (input: unknown) => Promise<Step | Verify> };

declare global { interface Window { } }

function initialize(): void {
  const panel = document.getElementById('mentor-course-panel');
  if (!panel || panel.querySelector('#handson-mode-view')) return;
  const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));
  const reference = buttons.find(b => b.textContent?.includes('逐步教学'));
  if (!reference?.parentElement) return;
  const tabs = reference.parentElement;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'handson-tab';
  button.textContent = '手把手教学';
  tabs.append(button);
  const view = document.createElement('section');
  view.id = 'handson-mode-view';
  view.hidden = true;
  view.innerHTML = `
    <div class="handson-heading">你想亲手开发什么功能？</div>
    <textarea class="handson-goal" rows="3" placeholder="例如：创建登录系统，教我一步一步写"></textarea>
    <button type="button" class="handson-start">开始手把手教学</button>
    <div class="handson-status" role="status" aria-live="polite"></div>
    <article class="handson-step" hidden>
      <strong class="handson-title"></strong>
      <div class="handson-path"></div>
      <div id="handson-location-banner" class="handson-location-banner" role="status">点击开始后，我会在左边指示你从哪里写。</div>
      <button type="button" class="handson-open">打开这个文件</button>
      <p class="handson-instruction"></p>
      <div class="handson-help-controls">
        <button type="button" class="handson-hint">提示</button>
        <button type="button" class="handson-reveal">参考答案</button>
      </div>
      <p class="handson-explanation" hidden></p>
      <div class="handson-reference" hidden>
        <div class="handson-caption">参考代码（请亲自输入，不会自动写入文件）</div>
        <pre class="handson-example"></pre>
      </div>
      <button type="button" class="handson-verify">检查我写的代码</button>
      <button type="button" class="handson-next" hidden>通过了，进入下一步</button>
    </article>`;
  tabs.insertAdjacentElement('afterend', view);
  const get = <T extends HTMLElement>(name: string): T => view.querySelector<T>('.handson-' + name)!;
  const goal = get<HTMLTextAreaElement>('goal');
  const status = get<HTMLElement>('status');
  const content = get<HTMLElement>('step');
  const start = get<HTMLButtonElement>('start');
  const open = get<HTMLButtonElement>('open');
  const verify = get<HTMLButtonElement>('verify');
  const next = get<HTMLButtonElement>('next');
  const hint = get<HTMLButtonElement>('hint');
  const reveal = get<HTMLButtonElement>('reveal');
  const exampleView = get<HTMLElement>('example');
  const explanation = get<HTMLElement>('explanation');
  const referenceBox = get<HTMLElement>('reference');
  let active = false;
  let step: Step | null = null;
  let history: Step[] = [];
  let busy = false;
  let root = '';
  const api = (window as unknown as {tutorIde: TutorApi}).tutorIde;
  const otherChildren = Array.from(panel.children).filter(el => el !== view && el !== tabs && !el.classList.contains('mentor-course-heading')) as HTMLElement[];
  function setActive(on: boolean): void {
    active = on;
    view.hidden = !on;
    panel!.classList.toggle('handson-active', on);
    button.classList.toggle('selected', on);
    for (const el of otherChildren) el.style.display = on ? 'none' : '';
    if (on) { view.style.display = 'flex'; panel!.scrollTop = 0; }
    else view.style.display = 'none';
  }
  button.addEventListener('click', () => setActive(true));
  tabs.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('button') !== button) setActive(false); });
  async function request(mode: 'next'|'verify'|'reference'): Promise<Step | Verify | {example:string} | null> {
    if (busy || !goal.value.trim()) return null;
    busy = true; start.disabled = true; verify.disabled = true; next.disabled = true;
    status.textContent = mode === 'verify' ? 'AI 正在检查你写的代码…' : 'AI 正在阅读当前项目，准备下一步…';
    try {
      const snap = await api.restoreProject();
      if (!snap) throw new Error('请先打开一个真实项目。');
      if (root !== snap.rootPath) { root = snap.rootPath; history = []; step = null; }
      return await api.handsonStep({mode, goal: goal.value.trim(), previous: step, history});
    } catch (e) { status.textContent = e instanceof Error ? e.message : String(e); return null; }
    finally { busy = false; start.disabled = false; verify.disabled = false; next.disabled = false; }
  }
  async function showNext(): Promise<void> {
    const output = await request('next');
    if (!output || !('file' in output)) return;
    step = output;
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('code-tutor-handson-placement-step', {detail:{file:output.file,anchor:output.anchor || '',line:output.line || 1,title:output.title}})));
    history.push(output);
    get<HTMLElement>('title').textContent = `${history.length}. ${output.title || '开始写代码'}`;
    get<HTMLElement>('path').textContent = `现在打开：${output.file}`;
    get<HTMLElement>('instruction').textContent = output.instruction;
    get<HTMLElement>('example').textContent = output.example;
    explanation.textContent = output.explanation;
    explanation.hidden = true;
    referenceBox.hidden = true;
    hint.textContent = '提示';
    reveal.textContent = '参考答案';
    content.hidden = false;
    next.hidden = true;
    status.textContent = '先按上面的任务自己尝试。需要帮助时再看提示或参考代码。';
    window.dispatchEvent(new CustomEvent('code-tutor-handson-guide', {detail:{file: output.file, anchor: output.anchor || '', line: output.line || 1, task: output.title}}));
  }
  start.addEventListener('click', () => { step=null;history=[];void showNext(); });
  hint.addEventListener('click', () => { if (!step) return; explanation.hidden = !explanation.hidden; hint.textContent = explanation.hidden ? '提示' : '收起提示'; });
  // HANDSON_REFERENCE_ON_DEMAND_V1
  reveal.addEventListener('click', async () => {
    if (!step) return;
    if (!referenceBox.hidden) {
      referenceBox.hidden = true;
      reveal.textContent = '参考答案';
      return;
    }
    referenceBox.hidden = false;
    exampleView.closest('details')?.setAttribute('open', '');
    reveal.textContent = '收起参考答案';
    const existing = step.example?.trim() || '';
    if (existing) {
      exampleView.textContent = existing;
      return;
    }
    exampleView.textContent = '正在按当前步骤生成参考代码…';
    reveal.disabled = true;
    try {
      const result = await request('reference');
      if (!result || !('example' in result) || !result.example?.trim()) {
        exampleView.textContent = '参考代码暂时没有生成。请再点一次“收起参考答案”，然后重新展开重试。';
        return;
      }
      if (!step) return;
      step.example = result.example;
      exampleView.textContent = result.example;
    } catch (error) {
      exampleView.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      reveal.disabled = false;
    }
  });
  open.addEventListener('click', () => { if(step) window.dispatchEvent(new CustomEvent('code-tutor-handson-guide',{detail:{file:step.file,anchor:step.anchor || '',line:step.line || 1,task:step.title}})); });
  verify.addEventListener('click', async () => {
    if (!step) return;
    const result = await request('verify');
    if (!result || !('passed' in result)) return;
    status.textContent = result.feedback || (result.passed ? '检查通过！' : '还有一点需要调整。');
    next.hidden = !result.passed;
  });
  next.addEventListener('click', () => void showNext());
}

function boot(): void {
  initialize();
  const observer = new MutationObserver(() => { if(!document.getElementById('handson-mode-view')) initialize(); });
  observer.observe(document.documentElement, {childList:true,subtree:true});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
else boot();
