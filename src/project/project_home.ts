import './project_home.css';

/** Welcome page and templates. The IDE's existing Monaco/session is left intact
 * behind the page, and reloaded only after the native project state changes. */
function installProjectHome(): void {
  if (document.getElementById('project-home')) return;
  const commandBar = document.querySelector<HTMLElement>('.commandbar');
  const projectGroup = commandBar?.querySelector<HTMLElement>('.command-group-project');
  if (!commandBar || !projectGroup || !window.tutorIde ||
      typeof window.tutorIde.closeProject !== 'function' ||
      typeof window.tutorIde.createTemplateProject !== 'function') return;

  const homeButton = document.createElement('button');
  homeButton.type = 'button';
  homeButton.id = 'project-home-button';
  homeButton.textContent = '⌂ 项目首页';
  homeButton.title = '关闭当前项目并返回欢迎页';
  projectGroup.append(homeButton);

  const overlay = document.createElement('section');
  overlay.className = 'project-home';
  overlay.id = 'project-home';
  overlay.setAttribute('aria-label', '项目首页');
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="project-home-inner">
      <header class="project-home-heading">
        <div class="project-home-brand">🤖 CODE TUTOR STUDIO</div>
        <h1>想从哪里开始？</h1>
        <p>打开已有项目，或通过模板从零开始创建。</p>
      </header>
      <div class="project-home-actions">
        <button type="button" data-home-open>📂 打开已有项目</button>
        <button type="button" data-home-template>✨ 创建项目</button>
      </div>
      <section class="project-home-template" data-home-template-form hidden>
        <div class="project-home-section-title">选择项目模板</div>
        <div class="project-home-options" role="group" aria-label="项目模板">
          <label><input type="radio" name="project-template" value="react-ts" checked><strong>React + TypeScript</strong><span>Vite · JSX · 组件与状态</span></label>
          <label><input type="radio" name="project-template" value="react-js"><strong>React + JavaScript</strong><span>Vite · JSX · JavaScript</span></label>
          <label><input type="radio" name="project-template" value="vanilla"><strong>HTML / CSS / JS</strong><span>不需要安装依赖</span></label>
          <label><input type="radio" name="project-template" value="empty"><strong>空白项目</strong><span>从一个 README 开始</span></label>
        </div>
        <label class="project-home-name">项目文件夹名称
          <input type="text" data-home-name value="my-new-project" maxlength="60" spellcheck="false" autocomplete="off" />
        </label>
        <p class="project-home-help">下一步会弹出系统目录选择框。将在选定目录下新建同名文件夹，不覆盖已有内容。React 模板只生成文件，不自动安装依赖。</p>
        <button type="button" data-home-create class="project-home-primary">选择保存位置并创建</button>
      </section>
      <p class="project-home-status" data-home-status role="status" aria-live="polite"></p>
    </div>
  `;
  document.body.append(overlay);

  const openButton = overlay.querySelector<HTMLButtonElement>('[data-home-open]')!;
  const templateButton = overlay.querySelector<HTMLButtonElement>('[data-home-template]')!;
  const createButton = overlay.querySelector<HTMLButtonElement>('[data-home-create]')!;
  const templateForm = overlay.querySelector<HTMLElement>('[data-home-template-form]')!;
  const nameField = overlay.querySelector<HTMLInputElement>('[data-home-name]')!;
  const status = overlay.querySelector<HTMLElement>('[data-home-status]')!;
  let busy = false;

  function showHome(): void {
    overlay.hidden = false;
    homeButton.disabled = true;
    document.documentElement.dataset.projectHome = 'true';
  }
  function hideHome(): void {
    overlay.hidden = true;
    homeButton.disabled = false;
    delete document.documentElement.dataset.projectHome;
  }
  function fail(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : String(error);
  }

  homeButton.addEventListener('click', async () => {
    if (busy) return;
    const dirty = document.querySelector<HTMLElement>('#editor-tab-dot')?.dataset.dirty === 'true';
    const question = dirty
      ? '当前文件存在未保存修改。关闭项目会丢失这些未保存修改，但不会删除磁盘上的项目文件。仍要关闭吗？'
      : '关闭当前项目并返回项目首页？磁盘上的项目文件不会删除。';
    if (!window.confirm(question)) return;
    busy = true;
    homeButton.disabled = true;
    try {
      await window.tutorIde.cancelAgent?.().catch(() => false);
      await window.tutorIde.stopTerminal?.().catch(() => false);
      await window.tutorIde.unwatchProjectFile().catch(() => false);
      await window.tutorIde.closeProject!();
      window.location.reload();
    } catch (error) {
      fail(error);
      homeButton.disabled = false;
      busy = false;
    }
  });

  openButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    openButton.disabled = true;
    status.textContent = '正在选择项目文件夹…';
    try {
      const result = await window.tutorIde.openProject();
      if (result) window.location.reload();
      else status.textContent = '已取消选择。';
    } catch (error) { fail(error); }
    finally { busy = false; openButton.disabled = false; }
  });

  templateButton.addEventListener('click', () => {
    templateForm.hidden = !templateForm.hidden;
    if (!templateForm.hidden) nameField.focus();
  });
  // Robot menu uses the same official-template creation page and state.
  window.addEventListener('code-tutor-open-project-creator', () => {
    if (busy) return;
    showHome();
    templateForm.hidden = false;
    status.textContent = '';
    nameField.focus();
  });
  createButton.addEventListener('click', async () => {
    if (busy) return;
    const name = nameField.value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(name)) {
      status.textContent = '项目名称只能包含英文、数字、横线或下划线，且必须以字母或数字开头。';
      nameField.focus();
      return;
    }
    const template = overlay.querySelector<HTMLInputElement>('input[name="project-template"]:checked')?.value ?? 'react-ts';
    busy = true;
    createButton.disabled = true;
    status.textContent = '请选择项目保存位置…';
    try {
      const result = await window.tutorIde.createTemplateProject!({ name, template });
      if (result) window.location.reload();
      else status.textContent = '已取消创建，没有写入文件。';
    } catch (error) { fail(error); }
    finally { busy = false; createButton.disabled = false; }
  });

  // Startup: unlike the editor's demo project, a missing saved real-project
  // root means the user should see the project welcome page.
  void window.tutorIde.getAppState().then((state) => {
    if (!state.lastProjectRoot) showHome();
    else hideHome();
  }).catch((error) => {
    showHome();
    fail(error);
  });
}

// This module is imported before main.ts creates the IDE shell.
// DOMContentLoaded might already have fired by then, so keep observing until
// the commandbar and Electron bridge are available.
function bootstrapProjectHome(): void {
  if (document.getElementById('project-home')) return;
  const ready = Boolean(
    document.querySelector('.commandbar .command-group-project')
      && window.tutorIde?.closeProject
      && window.tutorIde?.createTemplateProject,
  );
  if (ready) {
    installProjectHome();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector('.commandbar .command-group-project')) return;
    if (!window.tutorIde?.closeProject || !window.tutorIde?.createTemplateProject) return;
    observer.disconnect();
    installProjectHome();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapProjectHome, { once: true });
} else {
  bootstrapProjectHome();
}
