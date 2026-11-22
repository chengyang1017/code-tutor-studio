import { useEffect, useRef, useState } from 'react';
import { isSensitivePath } from '../../../shared/teaching/session';
import type { EditorEvent, Selection } from '../editor/protocol';
import type { EditorHandle } from '../editor/Editor';
import { workspace } from '../platform/workspace';
import type { Entry, FileSnapshot, Project } from '../platform/workspace';
import { confirm, errorMessage } from './feedback';

type Tab = FileSnapshot & { id: string; path: string; saved: string; selection: Selection };
type OpenProject = (project: Project) => Promise<void>;

const noSelection = { from: 0, to: 0 };
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const containsPath = (parent: string, path: string) => path === parent || path.startsWith(parent + '/');

export function useProject(report: (message: string) => void, loadLesson: OpenProject, autoSave: boolean) {
  const [project, setProject] = useState<Project>();
  const [dirs, setDirs] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<string[]>(['']);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const projectRef = useRef<Project | undefined>(undefined);
  const tabsRef = useRef<Tab[]>([]);
  const tabSequence = useRef(0);
  const activeRef = useRef('');
  const editor = useRef<EditorHandle>(null);
  const writeLocks = useRef(new Set<string>());
  const lastConflict = useRef(new Set<string>());
  const switching = useRef(true);

  function updateTabs(update: (previous: Tab[]) => Tab[]) {
    tabsRef.current = update(tabsRef.current);
    setTabs(tabsRef.current);
  }

  function activate(path: string) {
    activeRef.current = path;
    setActive(path);
  }

  async function install(next: Project) {
    projectRef.current = next;
    setProject(next);
    setDirs({});
    setExpanded(['']);
    for (const tab of tabsRef.current) editor.current?.send({ type: 'forget', id: tab.id });
    updateTabs(() => []);
    activate('');
    lastConflict.current.clear();
    await Promise.all([refresh(next, ''), loadLesson(next)]);
  }

  async function refresh(expected: Project, path: string) {
    const entries = await workspace.list(expected.id, path);
    if (projectRef.current?.id === expected.id) setDirs(previous => ({ ...previous, [path]: entries }));
  }

  useEffect(() => {
    workspace.restore().then(next => next && install(next)).catch(error => report(errorMessage(error))).finally(() => {
      switching.current = false;
      setBusy(false);
    });
  }, []);

  async function choose(name: string | null) {
    if (switching.current || writeLocks.current.size > 0) return;
    switching.current = true;
    setBusy(true);
    try {
      if (tabsRef.current.some(tab => tab.saved !== tab.text) &&
          !await confirm('切换项目', '丢弃当前项目中的未保存编辑？', '丢弃并选择', true)) return;
      const next = await workspace.pick(name);
      if (next) await install(next);
    } finally {
      switching.current = false;
      setBusy(false);
    }
  }

  async function open(path: string, reload = false): Promise<Tab | undefined> {
    const expected = projectRef.current;
    if (!expected || switching.current) return;
    let tab = tabsRef.current.find(item => item.path === path);
    if (!tab || reload) {
      if (!tab && tabsRef.current.length >= 24) throw new Error('最多同时打开 24 个文件，请先关闭一个标签');
      const snapshot = await workspace.read(expected.id, path);
      if (projectRef.current?.id !== expected.id || switching.current) return;
      const raced = tabsRef.current.find(item => item.path === path);
      if (!raced && tabsRef.current.length >= 24) throw new Error('最多同时打开 24 个文件，请先关闭一个标签');
      if (reload) {
        if (writeLocks.current.has(path)) throw new Error('磁盘保存还在进行，请稍后重读');
        if (raced !== tab) throw new Error('文件在重新读取期间已编辑，请重试');
        if (tab) editor.current?.send({ type: 'forget', id: tab.id });
      }
      tab = !reload && raced ? raced : { ...snapshot, id: ++tabSequence.current + ':' + path, path, saved: snapshot.text, selection: noSelection };
      const opened = tab;
      updateTabs(items => [...items.filter(item => item.path !== path), opened]);
      lastConflict.current.delete(path);
      if (reload && activeRef.current === path) {
        editor.current?.send({ type: 'open', id: tab.id, text: tab.text, readOnly: tab.readOnly });
      }
      if (snapshot.readOnly) report('检测到混合换行符，此文件以只读模式打开。');
    }
    activate(path);
    return tab;
  }

  async function read(path: string) {
    const expected = projectRef.current;
    if (!expected) throw new Error('请先打开项目');
    const buffer = tabsRef.current.find(tab => tab.path === path);
    const value = buffer ?? await workspace.read(expected.id, path);
    if (projectRef.current?.id !== expected.id) throw new Error('项目已切换');
    return value;
  }

  async function save(path: string, automatic = false) {
    const expected = projectRef.current;
    const draft = tabsRef.current.find(item => item.path === path);
    if (!expected || !draft || draft.saved === draft.text || draft.readOnly || switching.current ||
        writeLocks.current.has(path) || (automatic && (lastConflict.current.has(path) || isSensitivePath(path)))) return;
    writeLocks.current.add(path);
    try {
      if (isSensitivePath(path) && !await confirm('保存敏感文件', path, '保存')) return;
      const revision = await workspace.write(expected.id, path, draft.revision, draft.text);
      updateTabs(items => items.map(tab => tab.path === path ? { ...tab, saved: draft.text, revision } : tab));
      lastConflict.current.delete(path);
      if (!automatic) report('已保存 ' + path);
    } catch (error) {
      lastConflict.current.add(path);
      report(errorMessage(error) + '。可复制当前内容，再使用「重读」载入磁盘版本。');
    } finally {
      writeLocks.current.delete(path);
    }
  }

  function removeTabs(path: string) {
    for (const tab of tabsRef.current.filter(item => containsPath(path, item.path))) {
      editor.current?.send({ type: 'forget', id: tab.id });
    }
    updateTabs(items => items.filter(item => !containsPath(path, item.path)));
    if (containsPath(path, activeRef.current)) activate(tabsRef.current.at(-1)?.path ?? '');
  }

  async function close(path: string) {
    const tab = tabsRef.current.find(item => item.path === path);
    if (writeLocks.current.has(path)) return;
    if (tab && tab.text !== tab.saved && !await confirm('关闭标签', '丢弃此文件的未保存编辑？', '丢弃', true)) return;
    removeTabs(path);
  }

  async function toggleDirectory(path: string) {
    if (expanded.includes(path)) {
      setExpanded(previous => previous.filter(item => item !== path));
      return;
    }
    const expected = projectRef.current;
    if (expected) {
      await refresh(expected, path);
      if (projectRef.current?.id === expected.id) setExpanded(previous => [...new Set([...previous, path])]);
    }
  }

  async function create(parent: string, name: string, directory: boolean) {
    const expected = projectRef.current;
    if (!expected || switching.current) return;
    const path = await workspace.create(expected.id, parent, name, directory);
    await refresh(expected, parent);
    if (projectRef.current?.id !== expected.id) return;
    setExpanded(previous => [...new Set([...previous, parent])]);
    if (!directory) await open(path);
  }

  async function mutate(path: string, newName?: string) {
    const expected = projectRef.current;
    if (!expected || switching.current || [...writeLocks.current].some(item => containsPath(path, item))) return;
    const affected = () => tabsRef.current.filter(item => containsPath(path, item.path));
    if (affected().some(tab => tab.text !== tab.saved)) throw new Error('请先保存或关闭目标下的未保存文件');
    const deletion = newName === undefined;
    if (!await confirm(deletion ? '删除项目文档' : '重命名项目文档',
      deletion ? '删除 ' + path + ' 及其子项？Android 文档提供程序可能无法恢复。' : path + ' → ' + newName,
      deletion ? '删除' : '重命名', deletion)) return;
    if (projectRef.current?.id !== expected.id || switching.current ||
        [...writeLocks.current].some(item => containsPath(path, item)) || affected().some(tab => tab.text !== tab.saved)) {
      throw new Error('项目或目标已变化，请重试');
    }
    switching.current = true;
    setBusy(true);
    try {
      if (deletion) await workspace.delete(expected.id, path, true);
      else await workspace.rename(expected.id, path, newName);
      removeTabs(path);
      setExpanded(previous => previous.filter(item => !containsPath(path, item)));
      await refresh(expected, parentOf(path));
    } finally {
      switching.current = false;
      setBusy(false);
    }
  }

  function onEditorEvent(event: EditorEvent) {
    if (event.type === 'ready') {
      setReady(true);
      const tab = tabsRef.current.find(item => item.path === activeRef.current);
      if (tab) editor.current?.send({ type: 'open', id: tab.id, text: tab.text, readOnly: tab.readOnly });
      return;
    }
    const file = tabsRef.current.find(item => item.id === event.id);
    if (!file) return;
    if (event.type === 'save') { void save(file.path); return; }
    if (event.type === 'limit') { report('编辑内容超过 512 KiB 上限。'); return; }
    if (event.type === 'stale') { report('编辑缓冲区已变化，修改未应用。请重新预览。'); return; }
    if (event.type === 'change' && !file.readOnly) {
      updateTabs(items => items.map(tab => tab.path === file.path ? { ...tab, text: event.text, selection: event.selection } : tab));
    }
    if (event.type === 'selection' && event.selection.to <= file.text.length) {
      updateTabs(items => items.map(tab => tab.path === file.path ? { ...tab, selection: event.selection } : tab));
    }
  }

  useEffect(() => {
    const tab = tabsRef.current.find(item => item.path === active);
    if (ready && tab) editor.current?.send({ type: 'open', id: tab.id, text: tab.text, readOnly: tab.readOnly });
  }, [active, project?.id, ready]);

  useEffect(() => {
    if (!autoSave || busy) return;
    const pending = tabs.filter(tab => tab.saved !== tab.text && !isSensitivePath(tab.path));
    if (!pending.length) return;
    const timer = setTimeout(() => { for (const tab of pending) void save(tab.path, true); }, 1000);
    return () => clearTimeout(timer);
  }, [autoSave, tabs, busy]);

  return {
    project, dirs, expanded, tabs, active, busy, ready, editor, onEditorEvent, choose, open, read, save, close,
    toggleDirectory, create, mutate,
    getProject: () => projectRef.current,
    getActive: () => tabsRef.current.find(item => item.path === activeRef.current),
    refreshRoot: () => projectRef.current && refresh(projectRef.current, ''),
    resetEditor: () => setReady(false),
  };
}

export type WorkspaceModel = ReturnType<typeof useProject>;
