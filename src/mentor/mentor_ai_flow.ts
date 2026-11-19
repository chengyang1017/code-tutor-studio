import './mentor_ai_flow.css';

type Draft = { id: string; summary: string; files: Array<{ path: string; exists: boolean }> };
type Api = {
  ask: (goal: string) => Promise<{ questions: Array<{ question: string; options: string[] }> }>;
  draft: (data: { goal: string; answers: string[] }) => Promise<Draft>;
  apply: (id: string, confirmed: boolean) => Promise<{ needsConfirmation: boolean; overwrites?: string[]; firstFile?: string; files?: string[] }>;
};
function bridge(): Api {
  const api = (window as Window & { mentorAi?: Api }).mentorAi;
  if (!api) throw new Error('AI mentor backend unavailable. Restart the IDE.');
  return api;
}
function install(): boolean {
  const panel = document.querySelector<HTMLElement>('#mentor-course-panel');
  const heading = panel?.querySelector<HTMLElement>('.mentor-course-heading');
  const original = panel?.querySelector<HTMLElement>('.mentor-course-body');
  if (!panel || !heading || !original) return false;
  if (panel.querySelector('[data-ai-code-flow]')) return true;

  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'mentor-ai-tab'; tab.textContent = 'AI 编码';
  // The unified AI planning tab is the only entry; do not add a fifth header button.

  const section = document.createElement('section');
  section.className = 'mentor-ai-flow'; section.dataset.aiCodeFlow = 'true'; section.hidden = true;
  section.innerHTML = `
    <label>你想开发什么软件？</label>
    <textarea data-ai-goal rows="3" placeholder="例如：做一个有商品、客户和报表的订单管理系统"></textarea>
    <button data-ai-send type="button">发送需求</button>
    <div data-ai-status role="status"></div>
    <form data-ai-questions hidden>
      <strong>先回答几个问题</strong>
      <div data-ai-fields></div>
      <button type="submit">回答完成，生成代码</button>
    </form>
    <div data-ai-draft hidden>
      <strong data-ai-summary></strong>
      <div data-ai-files></div>
      <button type="button" data-ai-write>写入代码并打开文件</button>
    </div>
    <button type="button" data-ai-reset>重新描述</button>`;
  let planView = panel.querySelector<HTMLElement>('[data-unified-view="plan"]');
  if (planView) {
    planView.replaceChildren(section);
  } else {
    original.after(section);
  }
  // Both mentor modules initialize asynchronously. Whichever loads first,
  // this consolidates the AI page into ONE composer instead of stacking both.
  const reconcilePlanView = (): void => {
    const current = panel.querySelector<HTMLElement>('[data-unified-view="plan"]');
    if (!current) return;
    planView = current;
    if (section.parentElement !== current || current.childElementCount !== 1) {
      current.replaceChildren(section);
    }
  };
  new MutationObserver(reconcilePlanView).observe(panel, { childList: true, subtree: true });
  reconcilePlanView();

  const goal = section.querySelector<HTMLTextAreaElement>('[data-ai-goal]')!;
  const send = section.querySelector<HTMLButtonElement>('[data-ai-send]')!;
  const status = section.querySelector<HTMLElement>('[data-ai-status]')!;
  const questionForm = section.querySelector<HTMLFormElement>('[data-ai-questions]')!;
  const fields = section.querySelector<HTMLElement>('[data-ai-fields]')!;
  const draftBox = section.querySelector<HTMLElement>('[data-ai-draft]')!;
  const summary = section.querySelector<HTMLElement>('[data-ai-summary]')!;
  const fileList = section.querySelector<HTMLElement>('[data-ai-files]')!;
  const write = section.querySelector<HTMLButtonElement>('[data-ai-write]')!;
  const reset = section.querySelector<HTMLButtonElement>('[data-ai-reset]')!;
  let active = false; let busy = false; let pending: Draft | null = null;
  const setBusy = (value: boolean): void => {
    busy = value; send.disabled = value; write.disabled = value;
    const submit = questionForm.querySelector<HTMLButtonElement>('[type=submit]');
    if (submit) submit.disabled = value;
  };
  const show = (value: boolean): void => {
    active = value; section.hidden = !value; if (!planView) original.hidden = value;
    tab.dataset.active = String(value);
    panel.dataset.aiFlow = String(value);
    if (value) goal.focus();
  };
  tab.addEventListener('click', () => show(!active));
  const syncTab = (): void => show(panel.dataset.unifiedTab === 'plan');
  new MutationObserver(syncTab).observe(panel, { attributes: true, attributeFilter: ['data-unified-tab'] });
  syncTab();
  window.addEventListener('code-tutor-open-ai-coding', () => {
    const opener = document.getElementById('mentor-course-toggle');
    if (panel.hidden) opener?.click();
    const planTab = panel.querySelector<HTMLButtonElement>('[data-unified-tab=plan]');
    if (planTab) planTab.click();
    show(true);
  });
  send.addEventListener('click', async () => {
    if (busy || !goal.value.trim()) return;
    setBusy(true); status.textContent = 'AI 正在理解需求并准备问题…';
    questionForm.hidden = true; draftBox.hidden = true; pending = null;
    try {
      const result = await bridge().ask(goal.value.trim());
      fields.replaceChildren();
      // AI_ADAPTIVE_ZERO_QUESTIONS
      if (!result.questions.length) {
        questionForm.hidden = true;
        status.textContent = 'AI has enough information. Generating code now...';
        // The send handler must finish and release busy before submitting.
        window.setTimeout(() => questionForm.requestSubmit(), 0);
        return;
      }
      result.questions.forEach((entry, index) => {
        const field = document.createElement('fieldset');
        field.className = 'mentor-ai-choice-question';
        field.dataset.aiQuestion = entry.question;
        const legend = document.createElement('legend');
        legend.textContent = `${index + 1}. ${entry.question}`;
        field.append(legend);
        const options = entry.options.length ? entry.options : ['交给 AI 决定'];
        options.forEach((value) => {
          const label = document.createElement('label');
          label.className = 'mentor-ai-choice-option';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `mentor-ai-choice-${index}`;
          radio.value = value;
          radio.required = true;
          radio.dataset.aiChoice = String(index);
          const text = document.createElement('span');
          text.textContent = value;
          label.append(radio, text);
          field.append(label);
        });
        const customLabel = document.createElement('label');
        customLabel.className = 'mentor-ai-choice-option mentor-ai-custom-option';
        const customRadio = document.createElement('input');
        customRadio.type = 'radio';
        customRadio.name = `mentor-ai-choice-${index}`;
        customRadio.value = '__custom__';
        customRadio.required = true;
        const customText = document.createElement('span');
        customText.textContent = '自己填写';
        customLabel.append(customRadio, customText);
        field.append(customLabel);
        const customAnswer = document.createElement('textarea');
        customAnswer.className = 'mentor-ai-custom-answer';
        customAnswer.placeholder = '写下你自己的需求或答案…';
        customAnswer.rows = 3;
        customAnswer.maxLength = 2000;
        customAnswer.hidden = true;
        customAnswer.dataset.aiCustomAnswer = String(index);
        field.append(customAnswer);
        field.addEventListener('change', () => {
          const chosen = field.querySelector<HTMLInputElement>('input[type=radio]:checked');
          const isCustom = chosen?.value === '__custom__';
          customAnswer.hidden = !isCustom;
          customAnswer.required = isCustom;
          if (isCustom) customAnswer.focus();
        });
        fields.append(field);
      });
      questionForm.hidden = false; status.textContent = '请回答这些问题。';
    } catch (error) { status.textContent = String(error); }
    finally { setBusy(false); }
  });
  questionForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return;
    const answers = Array.from(fields.querySelectorAll<HTMLFieldSetElement>('[data-ai-question]')).map(field => {
      const selected = field.querySelector<HTMLInputElement>('input[type=radio]:checked');
      if (!selected) return '';
      if (selected.value === '__custom__') {
        const custom = field.querySelector<HTMLTextAreaElement>('[data-ai-custom-answer]')?.value.trim() || '';
        return custom ? `${field.dataset.aiQuestion}: ${custom}` : '';
      }
      return `${field.dataset.aiQuestion}: ${selected.value}`;
    });
    if (answers.some(x => !x)) { status.textContent = '请先回答所有问题。'; return; }
    setBusy(true); status.textContent = 'AI 正在生成实际源码…';
    try {
      pending = await bridge().draft({ goal: goal.value.trim(), answers });
      summary.textContent = pending.summary;
      fileList.replaceChildren();
      pending.files.forEach(file => {
        const item = document.createElement('div');
        item.textContent = `${file.exists ? '修改' : '新建'}：${file.path}`;
        fileList.append(item);
      });
      draftBox.hidden = false; status.textContent = '源码已生成，正在准备写入…';
      await applyPending();
    } catch (error) { status.textContent = String(error); }
    finally { setBusy(false); }
  });
  async function applyPending(): Promise<void> {
    if (!pending) return;
    if (document.querySelector<HTMLElement>('#editor-tab-dot')?.dataset.dirty === 'true') {
      status.textContent = '当前文件有未保存修改，请先 Ctrl+S 再写入。'; return;
    }
    const existing = pending.files.filter(x => x.exists).map(x => x.path);
    if (existing.length && !window.confirm(`将覆盖以下现有文件（不创建备份）：\n${existing.join('\n')}\n\n确定继续？`)) {
      status.textContent = '已取消写入。'; return;
    }
    status.textContent = '正在将生成的源码写入项目…';
        const aiChangeBefore = await Promise.all(pending.files.map(async (file) => {
      if (!file.exists) return { path: file.path, before: null };
      const old = await window.tutorIde.readProjectFile(file.path);
      return { path: file.path, before: old.content };
    }));
    const result = await bridge().apply(pending.id, existing.length > 0);
    window.dispatchEvent(new CustomEvent('code-tutor-ai-change-summary', { detail: { files: aiChangeBefore } }));
    if (result.needsConfirmation) throw new Error('Overwrite confirmation is required.');
    status.textContent = `已写入 ${result.files?.length ?? 0} 个文件，正在打开源码…`;
    const openedFiles = result.files ?? (result.firstFile ? [result.firstFile] : []);
    if (result.firstFile) window.dispatchEvent(new CustomEvent('code-tutor-ai-generated-file', { detail: { path: result.firstFile } }));
    window.dispatchEvent(new CustomEvent('code-tutor-ai-coding-finished', {
      detail: { files: openedFiles, summary: pending.summary },
    }));
    pending = null;
  }
  write.addEventListener('click', async () => {
    if (busy || !pending) return;
    setBusy(true);
    try { await applyPending(); }
    catch (error) { status.textContent = String(error); }
    finally { setBusy(false); }
  });
  reset.addEventListener('click', () => {
    if (busy) return;
    questionForm.hidden = true; draftBox.hidden = true; pending = null;
    status.textContent = ''; goal.focus();
  });
  return true;
}
function bootstrap(): void {
  if (install()) return;
  const watcher = new MutationObserver(() => { if (install()) watcher.disconnect(); });
  watcher.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
