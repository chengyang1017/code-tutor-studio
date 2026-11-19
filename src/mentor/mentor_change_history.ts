import './mentor_change_history.css';

type FileChange = {
  path: string;
  kind: string;
  startLine: number;
  removedLines: number;
  addedLines: number;
  removedPreview: string;
  addedPreview: string;
  truncated: boolean;
};
type Entry = { id: string; at: string; goal: string; summary: string; files: FileChange[] };
type ChangeBridge = { list: () => Promise<Entry[]> };
declare global { interface Window { mentorChangeHistory?: ChangeBridge } }
function setup(): boolean {
  const panel = document.getElementById('mentor-course-panel');
  const header = panel?.querySelector('.mentor-course-heading');
  if (!panel || !header || !window.mentorChangeHistory) return false;
  if (panel.querySelector('[data-change-history]')) return true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mentor-history-toggle';
  button.textContent = '修改记录';
  button.title = '查看这个项目的每次 AI 修改';
  header.insertBefore(button, header.lastElementChild);
  const area = document.createElement('section');
  area.dataset.changeHistory = 'true';
  area.className = 'mentor-history-panel';
  area.hidden = true;
  area.innerHTML = `<div class="mentor-history-head"><strong>修改记录</strong><button type="button" data-history-back>返回教学</button></div><div data-history-list class="mentor-history-list"></div>`;
  panel.append(area);
  const listing = area.querySelector<HTMLElement>('[data-history-list]')!;
  let active = false;
  const update = async (): Promise<void> => {
    listing.textContent = '正在读取记录…';
    try {
      const entries = await window.mentorChangeHistory!.list();
      listing.replaceChildren();
      if (!entries.length) { listing.textContent = '这个项目还没有 AI 代码修改记录。'; return; }
      for (const entry of entries.slice().reverse()) {
        const item = document.createElement('details');
        item.className = 'mentor-history-entry';
        const heading = document.createElement('summary');
        heading.textContent = new Date(entry.at).toLocaleString() + ' · ' + (entry.goal || entry.summary || 'AI 修改');
        item.append(heading);
        if (entry.summary) {
          const p = document.createElement('p'); p.textContent = entry.summary; item.append(p);
        }
        for (const file of entry.files || []) {
          const row = document.createElement('div'); row.className = 'mentor-history-file';
          const open = document.createElement('button');
          open.type = 'button';
          open.textContent = (file.kind === 'new' ? '新增 ' : '修改 ') + file.path + ` (+${file.addedLines} / -${file.removedLines})`;
          open.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('ai-ide-reader-jump-request', {detail:{filePath:file.path,line:Math.max(1,file.startLine)}}));
          });
          row.append(open);
          if (file.removedPreview) {
            const oldText = document.createElement('pre'); oldText.className='mentor-history-removed';oldText.textContent='- '+file.removedPreview;row.append(oldText);
          }
          if (file.addedPreview) {
            const newText = document.createElement('pre');newText.className='mentor-history-added';newText.textContent='+ '+file.addedPreview;row.append(newText);
          }
          if (file.truncated) { const note = document.createElement('small');note.textContent='仅显示前 12 行差异预览';row.append(note); }
          item.append(row);
        }
        listing.append(item);
      }
    } catch (error) { listing.textContent = String(error); }
  };
  const toggle = (): void => {
    active=!active;
    area.hidden=!active;
    panel.classList.toggle('mentor-history-active',active);
    if (active) void update();
  };
  button.addEventListener('click',toggle);
  area.querySelector('[data-history-back]')?.addEventListener('click',toggle);
  return true;
}
if (!setup()) {
  const observer=new MutationObserver(()=>{if(setup())observer.disconnect();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
}
