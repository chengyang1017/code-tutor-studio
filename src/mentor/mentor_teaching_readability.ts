import './mentor_teaching_readability.css';

// Presentation only: preserve AI instructions and reference source exactly.
function formatInstruction(element: HTMLElement): void {
  const raw = element.textContent || '';
  if (element.dataset.formattedInstruction === raw) return;
  element.dataset.formattedInstruction = raw;
  const fragments = raw
    .replace(/\s*(完成标准|验收标准|目标文件|操作位置|当前任务|注意事项|具体要求|提示)\s*[：:]/g, '\n$1：')
    .replace(/\s+(?=(?:[1-9][0-9]*[)）.、]|[①②③④⑤⑥]))/g, '\n')
    .split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (fragments.length < 2 && raw.length > 130) {
    // Break prose only at sentence boundaries, not at arbitrary characters.
    const parts = raw.split(/(?<=[。！？；])\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      fragments.splice(0, fragments.length, ...parts);
    }
  }
  if (fragments.length === 0) return;
  const fragment = document.createDocumentFragment();
  for (const part of fragments) {
    const line = document.createElement('div');
    line.className = 'mentor-readable-line';
    if (/^(完成标准|验收标准|目标文件|操作位置|当前任务|注意事项|具体要求|提示)[:：]/.test(part)) {
      line.classList.add('mentor-readable-heading');
    } else if (/^[1-9][0-9]*[)）.、]/.test(part)) {
      line.classList.add('mentor-readable-item');
    }
    line.textContent = part;
    fragment.append(line);
  }
  element.replaceChildren(fragment);
}

const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:export|import|from|type|interface|const|let|var|function|return|if|else|async|await|try|catch|throw|new|class|extends|implements|public|private|readonly|typeof|as|void|string|number|boolean|unknown|null|undefined|true|false)\b|\b\d+(?:\.\d+)?\b)/g;

function highlightReference(element: HTMLElement): void {
  const raw = element.textContent || '';
  if (element.dataset.highlightedSource === raw) return;
  element.dataset.highlightedSource = raw;
  if (!raw.trim()) return;
  const fragment = document.createDocumentFragment();
  let previous = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(raw)) !== null) {
    if (match.index > previous) fragment.append(document.createTextNode(raw.slice(previous, match.index)));
    const token = match[0];
    const span = document.createElement('span');
    span.className = token.startsWith('//') || token.startsWith('/*') ? 'mentor-token-comment'
      : /^[\x27\x22`]/.test(token) ? 'mentor-token-string'
      : /^\d/.test(token) ? 'mentor-token-number' : 'mentor-token-keyword';
    span.textContent = token;
    fragment.append(span);
    previous = TOKEN_RE.lastIndex;
  }
  if (previous < raw.length) fragment.append(document.createTextNode(raw.slice(previous)));
  element.replaceChildren(fragment);
}

function update(): void {
  const view = document.getElementById('handson-mode-view');
  if (!view) return;
  const instruction = view.querySelector<HTMLElement>('.handson-instruction');
  const example = view.querySelector<HTMLElement>('.handson-example');
  if (instruction) formatInstruction(instruction);
  if (example) highlightReference(example);
}

let queued = false;
function scheduleUpdate(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; update(); });
}

function install(): void {
  update();
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
