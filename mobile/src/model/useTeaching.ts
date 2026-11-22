import { useEffect, useRef, useState } from 'react';
import { reactTodoLessons } from '../../../shared/teaching/react_todo_course';
import { locateTeachingChange } from '../../../shared/teaching/teaching_location';
import { planTeachingEdits, teachingProgress } from '../../../shared/teaching/teaching_completion';
import { isSafeTeachingCode } from '../../../shared/teaching/teaching_code_validation';
import {
  isSensitivePath, isTeachingStep, isTeachingVerification, teachingDiagnosticText,
} from '../../../shared/teaching/session';
import type { TeachingMode, TeachingRequest, TeachingSession } from '../../../shared/teaching/session';
import { requestTeaching } from '../platform/services';
import { semantics } from '../platform/semantics';
import { workspace } from '../platform/workspace';
import type { Project } from '../platform/workspace';
import type { WorkspaceModel } from './useProject';
import { confirm, errorMessage } from './feedback';

type Progress = { session: TeachingSession; course: number; coursePassed: boolean; aiPassed: boolean; verifiedFingerprint?: string };
type Reference = { path: string; data: unknown; example: string; step: NonNullable<TeachingSession['step']> };
const initial: Progress = { session: { goal: '', completed: 0, paused: false }, course: 0, coursePassed: false, aiPassed: false };
const requestLimit = 30000;

export function useTeaching(report: (message: string) => void) {
  const [progress, setProgress] = useState(initial);
  const [reference, setReference] = useState<Reference>();
  const [draft, setDraft] = useState<{ path: string; before: string; after: string; removed: string; added: string; range: { from: number; to: number } }>();
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const state = useRef(initial);
  const current = useRef<Project | undefined>(undefined);
  const pending = useRef<AbortController | undefined>(undefined);

  async function load(project: Project) {
    pending.current?.abort();
    current.current = project;
    state.current = initial;
    setProgress(initial);
    setReference(undefined);
    setDraft(undefined);
    setFeedback('');
    const raw = await workspace.getState(project.id);
    if (!raw || current.current?.id !== project.id) return;
    let data: Partial<Progress>;
    try { data = JSON.parse(raw); } catch { return; }
    if (!data || !data.session || typeof data.session.goal !== 'string') return;
    const loaded: Progress = {
      session: {
        goal: data.session.goal.slice(0, 1000),
        completed: Number.isSafeInteger(data.session.completed) ? Math.max(0, data.session.completed) : 0,
        paused: data.session.paused === true,
        step: isTeachingStep(data.session.step) ? data.session.step : undefined,
      },
      course: typeof data.course === 'number' && Number.isSafeInteger(data.course) ? Math.min(reactTodoLessons.length, Math.max(0, data.course)) : 0,
      coursePassed: data.coursePassed === true,
      aiPassed: data.aiPassed === true && typeof data.verifiedFingerprint === 'string',
      verifiedFingerprint: typeof data.verifiedFingerprint === 'string' ? data.verifiedFingerprint : undefined,
    };
    state.current = loaded;
    setProgress(loaded);
  }

  function update(change: Partial<Progress>) {
    const project = current.current;
    if (!project) return;
    const value = { ...state.current, ...change };
    state.current = value;
    setProgress(value);
    void workspace.putState(project.id, JSON.stringify(value)).catch(error => report(errorMessage(error)));
  }

  const lesson = reactTodoLessons[progress.course];
  const step = progress.session.step;
  function pause() {
    const paused = !state.current.session.paused;
    if (paused) {
      pending.current?.abort();
      setDraft(undefined);
    }
    update({ session: { ...state.current.session, paused } });
  }

  async function verifyCourse(files: WorkspaceModel) {
    if (!lesson || state.current.session.paused) return;
    const id = current.current?.id;
    const source = await files.read(lesson.file);
    if (current.current?.id !== id || state.current.session.paused) return;
    const failed = lesson.checks.filter(check => !check.test(source.text));
    update({ coursePassed: failed.length === 0 });
    setFeedback(failed.length ? '待完成：' + failed.map(check => check.label).join('、') : '本课源码检查通过。');
  }

  async function nextCourse(files: WorkspaceModel) {
    const started = state.current;
    if (!lesson || !started.coursePassed || started.session.paused) return;
    const source = await files.read(lesson.file);
    if (state.current !== started) return;
    if (!lesson.checks.every(check => check.test(source.text))) {
      update({ coursePassed: false });
      setFeedback('源码已变化，请重新验证本课。');
      return;
    }
    update({ course: Math.min(state.current.course + 1, reactTodoLessons.length), coursePassed: false });
    setFeedback('');
  }

  async function ask(mode: TeachingMode, files: WorkspaceModel, goal: string) {
    const project = current.current;
    const started = state.current;
    if (!project || started.session.paused || pending.current || files.busy) return;
    const normalizedGoal = goal.trim().slice(0, 1000);
    if (!normalizedGoal) throw new Error('请先输入项目教学目标');
    const session = { ...started.session, goal: normalizedGoal };
    if (mode === 'next' && session.step && started.aiPassed) {
      const verified = await files.read(session.step.file);
      const fingerprint = await workspace.fingerprint(verified.text);
      if (state.current !== started) return;
      if (fingerprint !== started.verifiedFingerprint) {
        update({ aiPassed: false, verifiedFingerprint: undefined });
        throw new Error('已验证的源码发生变化，请重新验证当前步骤');
      }
    }
    const active = files.getActive();
    const target = mode === 'next' ? active?.path : session.step?.file;
    if (mode !== 'next' && (!target || isSensitivePath(target))) throw new Error('请先获得可读取的教学步骤');
    const buffer = target && !isSensitivePath(target) ? await files.read(target) : undefined;
    if (mode !== 'next' && buffer && buffer.text.length > requestLimit) {
      throw new Error('AI 参考和验证需要完整目标文件，目前支持最多 30,000 个字符');
    }
    const paths = [...new Set(Object.values(files.dirs).flat().filter(entry => !entry.directory).map(entry => entry.path))]
      .filter(path => !isSensitivePath(path));
    if (target && buffer && !paths.includes(target)) paths.unshift(target);
    const safePaths = paths.slice(0, 250);
    const source = target && buffer ? {
      file: target,
      text: buffer.text.slice(0, requestLimit),
      selection: active?.path === target && active.selection.to <= requestLimit ? active.selection : undefined,
    } : undefined;
    const data: TeachingRequest = { mode, session, files: safePaths, source };
    if (!await confirm('发送教学上下文给 OpenAI',
      '发送教学目标、当前步骤和已展开目录中的文件名。' +
      (source ? ' 同时发送 ' + source.file + ' 的前 30,000 个字符及可用的选区范围。请先确认源码中没有秘密。' : ''),
      '发送')) return;
    if (current.current?.id !== project.id || state.current !== started || pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    const timeout = setTimeout(() => abort.abort(), 60000);
    setRunning(true);
    setFeedback('');
    try {
      const result = await requestTeaching(data, abort.signal);
      if (abort.signal.aborted || current.current?.id !== project.id || state.current !== started) return;
      if (mode === 'next') {
        if (!isTeachingStep(result) || !safePaths.includes(result.file) || isSensitivePath(result.file)) {
          throw new Error('AI 未返回已授权文件中的可用教学步骤。请先展开目标目录或打开文件。');
        }
        const step = {
          file: result.file, title: result.title, instruction: result.instruction,
          anchor: result.anchor, scope: result.scope, line: result.line,
        };
        update({ session: { ...session, step, completed: session.completed + (started.aiPassed ? 1 : 0) },
          aiPassed: false, verifiedFingerprint: undefined });
        setReference(undefined);
        setDraft(undefined);
        await files.open(result.file);
      } else if (mode === 'verify') {
        if (!isTeachingVerification(result) || !target || !buffer) throw new Error('AI 返回的验证结果不合法');
        const fingerprint = result.passed ? await workspace.fingerprint(buffer.text) : undefined;
        const latest = await files.read(target);
        if (current.current?.id !== project.id || state.current !== started || abort.signal.aborted) return;
        if (latest.text !== buffer.text) throw new Error('验证期间源码发生变化，请重新验证');
        update({ aiPassed: result.passed, verifiedFingerprint: fingerprint });
        setFeedback(result.feedback);
      } else if (session.step && target) {
        if (!result || typeof result !== 'object' || !('example' in result) || typeof result.example !== 'string' || result.example.length > 12000) throw new Error('AI 未返回可显示的参考代码');
        setReference({ path: target, data: result, example: result.example, step: session.step });
        setDraft(undefined);
        await files.open(target);
      }
    } catch (error) {
      if (!(abort.signal.aborted && (state.current.session.paused || current.current?.id !== project.id))) {
        report(abort.signal.aborted ? 'AI 请求已停止或超时' : errorMessage(error));
      }
    } finally {
      clearTimeout(timeout);
      if (pending.current === abort) {
        pending.current = undefined;
        setRunning(false);
      }
    }
  }

  function compare(text: string, saved: Reference) {
    const location = locateTeachingChange(text, saved.data, saved.step, semantics.scopes(saved.path, text));
    if (location.kind !== 'located') throw new Error(teachingDiagnosticText[location.kind]);
    const plan = planTeachingEdits(text, location);
    if (plan.kind !== 'edit') throw new Error(teachingDiagnosticText[plan.kind]);
    if (!plan.edits.every(edit => isSafeTeachingCode(saved.path, edit))) throw new Error('补全未通过源码安全检查');
    const progress = teachingProgress(plan, text);
    if (progress.kind !== 'pending') throw new Error('补全位置已变化或代码已完成');
    return {
      path: saved.path, before: text, after: plan.target,
      removed: plan.edits.map(edit => edit.original).filter(Boolean).join('\n⋯\n'),
      added: plan.edits.map(edit => edit.insertText).filter(Boolean).join('\n⋯\n'),
      range: { from: location.offset, to: location.offset + location.original.length },
    };
  }

  async function showPreview(files: WorkspaceModel) {
    if (!reference || state.current.session.paused || files.busy) return;
    setDraft(undefined);
    const tab = await files.open(reference.path);
    if (!tab || tab.readOnly || isSensitivePath(tab.path)) throw new Error('目标文件当前不可修改');
    const next = compare(tab.text, reference);
    setDraft(next);
  }

  async function apply(files: WorkspaceModel) {
    if (!draft || !reference || state.current.session.paused || files.busy || !files.ready) return;
    const tab = files.getActive();
    if (!tab || tab.path !== draft.path || tab.readOnly || tab.text !== draft.before) {
      setDraft(undefined);
      throw new Error('文件已变化，请重新定位和预览差异');
    }
    // Confirm against both the live editor and the current provider revision.
    const currentProject = current.current;
    if (!currentProject) return;
    const started = state.current;
    const disk = await workspace.read(currentProject.id, draft.path);
    if (files.getProject()?.id !== currentProject.id || state.current !== started ||
        files.getActive()?.id !== tab.id || files.getActive()?.text !== draft.before ||
        disk.revision !== tab.revision) {
      setDraft(undefined);
      throw new Error('文件或磁盘版本已变化，请重新读取和定位');
    }
    const checked = compare(tab.text, reference);
    if (checked.after !== draft.after) throw new Error('差异已变化，请重新预览');
    files.editor.current?.send({ type: 'replace', id: tab.id, before: tab.text, text: draft.after });
    setDraft(undefined);
    setFeedback('补全待检查。请查看编辑器并保存，或撤销此更改。');
    update({ aiPassed: false, verifiedFingerprint: undefined });
  }

  async function resetAi() {
    const started = state.current;
    if (!await confirm('重新开始 AI 教学', '会清除当前项目的 AI 步骤和完成记录。', '重新开始')) return;
    if (state.current !== started) return;
    pending.current?.abort();
    update({ session: { ...initial.session }, aiPassed: false, verifiedFingerprint: undefined });
    setReference(undefined);
    setDraft(undefined);
    setFeedback('');
  }

  useEffect(() => () => pending.current?.abort(), []);

  return {
    progress, lesson, step, reference, draft, running, feedback, load, pause, verifyCourse, nextCourse, ask,
    showPreview, apply, resetAi, discardPreview: () => setDraft(undefined),
  };
}
