import { monaco } from '../editor/monaco_setup';
import './inline_reference_enhancer.css';

// Enhance the existing inline tutor UI without replacing its handlers.
function installReferenceEnhancer(): void {
  const seen = new WeakMap<HTMLElement, string>();
  const pending = new WeakSet<HTMLElement>();

  function scan(): void {
    const widget = document.querySelector<HTMLElement>('.inline-copilot-widget');
    if (!widget) return;
    const help = widget.querySelector<HTMLElement>('.inline-copilot-help');
    if (!help || help.hidden) return;

    const pre = help.querySelector<HTMLElement>('pre.inline-copilot-answer-code, pre');
    if (!pre) return;
    const code = pre.querySelector<HTMLElement>('code');
    if (!code) return;

    const raw = code.dataset.referenceRaw ?? code.textContent ?? '';
    if (!raw.trim()) return;
    if (seen.get(pre) === raw || pending.has(pre)) return;
    pending.add(pre);
    code.dataset.referenceRaw = raw;

    let toolbar = help.querySelector<HTMLElement>('.inline-reference-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'inline-reference-toolbar';
      const location = document.createElement('span');
      location.className = 'inline-reference-location';
      location.textContent = '参考代码';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'inline-reference-copy';
      copy.textContent = '复制代码';
      copy.addEventListener('click', async (event) => {
        event.preventDefault();
        const value = code.dataset.referenceRaw ?? code.textContent ?? '';
        try {
          await navigator.clipboard.writeText(value);
          copy.textContent = '已复制';
        } catch {
          // Local Electron builds can deny clipboard permission; let the user select.
          copy.textContent = '复制失败，请选中代码复制';
        }
      });
      toolbar.append(location, copy);
      pre.before(toolbar);
    }

    const fileText = [
      help.querySelector('.inline-copilot-answer-label')?.textContent ?? '',
      widget.querySelector('.inline-copilot-location')?.textContent ?? '',
    ].join(' ');
    const ext = /\.([a-z0-9]+)(?:\b|:)/i.exec(fileText)?.[1]?.toLowerCase() ?? '';
    const language = ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', css: 'css', html: 'html', py: 'python', dart: 'dart',
      java: 'java', kt: 'kotlin', cs: 'csharp', sql: 'sql', md: 'markdown' } as Record<string, string>)[ext] ?? 'plaintext';

    seen.set(pre, raw);
    void monaco.editor.colorize(raw, language, {}).then((html) => {
      if (!code.isConnected || code.dataset.referenceRaw !== raw) return;
      code.innerHTML = html;
    }).catch(() => {
      // Keep plain text if Monaco cannot tokenize this language.
    }).finally(() => pending.delete(pre));
  }

  // The existing tutoring widget is created after main.ts initializes Monaco.
  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scan();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installReferenceEnhancer, { once: true });
} else {
  installReferenceEnhancer();
}
