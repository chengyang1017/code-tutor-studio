import './terminal_panel.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type TerminalApi = {
  startTerminal: (root: string) => Promise<{ cwd: string; shell: string }>;
  chooseTerminalFolder: () => Promise<string | null>;
  openTerminalFolderAsProject: (folder: string) => Promise<{ rootPath: string; projectName: string }>;
  resizeTerminal: (cols: number, rows: number) => Promise<boolean>;
  writeTerminal: (value: string) => Promise<boolean>;
  stopTerminal: () => Promise<boolean>;
  onTerminalData: (handler: (payload: { data: string }) => void) => () => void;
  onTerminalExit: (handler: (payload: { code: number | null; signal: string | null }) => void) => () => void;
};

function install(): boolean {
  const api = window.tutorIde as unknown as Partial<TerminalApi>;
  const bar = document.querySelector<HTMLElement>('.commandbar');
  const pane = document.querySelector<HTMLElement>('.editor-pane');
  if (!bar || !pane || !api.startTerminal || !api.chooseTerminalFolder || !api.resizeTerminal ||
      !api.writeTerminal || !api.stopTerminal || !api.onTerminalData || !api.onTerminalExit) return false;
  if (document.getElementById('real-terminal-panel')) return true;
  const group = document.createElement('div');
  group.className = 'command-group terminal-command-group';
  group.innerHTML = `<span class="command-group-label">TERMINAL</span><button type="button" data-terminal-toggle>⌨ 终端</button>`;
  bar.append(group);
  const panel = document.createElement('section');
  panel.id = 'real-terminal-panel';
  panel.className = 'terminal-panel';
  panel.hidden = true;
  panel.innerHTML = `<div class="terminal-header"><strong>PowerShell</strong><span data-cwd title="当前终端目录"></span>
    <button type="button" data-open-in-ide title="Open current terminal directory as IDE project">Open in IDE</button><button type="button" data-folder>更换路径</button><button type="button" data-clear>清空</button>
    <button type="button" data-restart>重启</button><button type="button" data-close aria-label="关闭终端">×</button></div>
    <div class="terminal-screen" data-screen></div>`;
  pane.append(panel);
  const screen = panel.querySelector<HTMLElement>('[data-screen]')!;
  const cwdLabel = panel.querySelector<HTMLElement>('[data-cwd]')!;
  const toggle = group.querySelector<HTMLButtonElement>('[data-terminal-toggle]')!;
  const term = new Terminal({ cursorBlink: true, scrollback: 4000, fontSize: 13,
    fontFamily: 'Cascadia Code, Consolas, monospace', theme: { background: '#101419', foreground: '#d9e0e9' } });
  term.options.disableStdin = false;
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  // xterm must own keyboard focus; Monaco and other IDE shortcuts must not
  // intercept key presses while the integrated terminal is active.
  const focusTerminal = (): void => {
    if (!panel.hidden) {
      term.focus();
    }
  };
  screen.addEventListener('pointerdown', () => {
    window.requestAnimationFrame(focusTerminal);
  });
  screen.addEventListener('click', focusTerminal);
  screen.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });
  let currentFolder = '';
  // PowerShell emits OSC 7 at each prompt. Track cwd after `cd`, not just at startup.
  term.parser.registerOscHandler(7, (data: string): boolean => {
    try {
      const uri = new URL(data);
      if (uri.protocol !== 'file:') return false;
      const pathname = decodeURIComponent(uri.pathname);
      const nextFolder = uri.hostname
        ? '\\\\' + uri.hostname + pathname.replaceAll('/', '\\')
        : (/^\/[a-zA-Z]:\//.test(pathname)
            ? pathname.slice(1).replaceAll('/', '\\')
            : pathname);
      if (!nextFolder) return false;
      currentFolder = nextFolder;
      cwdLabel.textContent = nextFolder;
      cwdLabel.title = nextFolder;
      return true;
    } catch { return false; }
  });
  let visible = false;
  let running = false;
  let busy = false;
  const useApi = api as TerminalApi;
  function projectFolder(): string {
    const badge = document.querySelector<HTMLElement>('#workspace-badge')?.textContent?.trim();
    if (badge !== '真实项目' && badge !== 'Real Project') return '';
    return document.querySelector<HTMLElement>('#project-root')?.textContent?.trim() || '';
  }
  function refit(): void {
    if (!visible) return;
    fit.fit();
    if (running) void useApi.resizeTerminal(term.cols, term.rows).catch(() => false);
  }
  const resizeObserver = new ResizeObserver(refit);
  resizeObserver.observe(screen);
  useApi.onTerminalData(({ data }) => term.write(data));
  useApi.onTerminalExit(({ code }) => { running = false; term.writeln(`\r\n[PowerShell exited: ${code}]`); });
  term.onData(value => {
    if (running) void useApi.writeTerminal(value).catch(error => term.writeln(`\r\n${String(error)}`));
  });
  async function start(folder: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      term.reset();
      const result = await useApi.startTerminal(folder);
      currentFolder = result.cwd;
      running = true;
      cwdLabel.textContent = result.cwd;
      cwdLabel.title = result.cwd;
      requestAnimationFrame(() => { refit(); term.focus(); });
    } catch (error) { term.writeln(`\r\nTerminal error: ${String(error)}`); }
    finally { busy = false; }
  }
  async function chooseFolder(): Promise<void> {
    const folder = await useApi.chooseTerminalFolder();
    if (folder) await start(folder);
  }
  async function show(): Promise<void> {
    visible = true;
    panel.hidden = false;
    pane!.dataset.terminalOpen = 'true';
    toggle.dataset.active = 'true';
    requestAnimationFrame(() => { refit(); requestAnimationFrame(focusTerminal); });
    if (!running && !busy) {
      const folder = currentFolder || projectFolder();
      if (folder) await start(folder);
      else await chooseFolder();
    }
    requestAnimationFrame(focusTerminal);
  }
  function hide(): void {
    visible = false; panel.hidden = true; pane!.dataset.terminalOpen = 'false'; toggle.dataset.active = 'false';
  }
  toggle.addEventListener('click', () => { if (visible) hide(); else void show(); });
  panel.querySelector('[data-close]')!.addEventListener('click', hide);
  panel.querySelector('[data-folder]')!.addEventListener('click', () => { void chooseFolder(); });
  panel.querySelector('[data-open-in-ide]')!.addEventListener('click', () => {
    void (async () => {
      if (!currentFolder || busy) return;
      const dirty = document.querySelector<HTMLElement>('#editor-tab-dot')?.dataset.dirty === 'true';
      if (dirty && !window.confirm('The current file has unsaved changes. Replace the IDE project?')) return;
      try {
        await useApi.openTerminalFolderAsProject(currentFolder);
        window.location.reload();
      } catch (error) {
        term.writeln('\r\n[open project] ' + String(error));
        term.focus();
      }
    })();
  });
  panel.querySelector('[data-clear]')!.addEventListener('click', () => term.clear());
  panel.querySelector('[data-restart]')!.addEventListener('click', () => {
    if (!busy && currentFolder) void start(currentFolder);
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '`') {
      event.preventDefault(); if (visible) hide(); else void show();
    }
  });
  window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect(); void useApi.stopTerminal(); term.dispose();
  }, { once: true });
  return true;
}
function bootstrap(): void {
  if (install()) return;
  const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();