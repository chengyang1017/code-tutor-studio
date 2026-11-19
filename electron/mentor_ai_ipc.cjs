'use strict';
const { ipcMain, app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const drafts = new Map();
const changeHistory = require('./mentor_change_history.cjs');
const mentorMemory = require('./mentor_ai_memory.cjs');
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.2';

async function state() {
  const file = path.join(app.getPath('userData'), 'ai-code-tutor', 'state.json');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function key() {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  const saved = (await state()).encryptedOpenAiKey;
  if (!saved || !safeStorage.isEncryptionAvailable()) throw new Error('Please configure your OpenAI API key in the IDE.');
  return safeStorage.decryptString(Buffer.from(saved, 'base64'));
}
async function root() {
  const value = (await state()).lastProjectRoot;
  if (!value) throw new Error('Open a local project first.');
  const abs = path.resolve(value);
  if (!(await fs.stat(abs)).isDirectory()) throw new Error('Project directory no longer exists.');
  return abs;
}
async function ai(system, user, limit = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: [
        { role: 'system', content: system }, { role: 'user', content: user },
      ], max_output_tokens: limit }), signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);
    if (payload.status === 'incomplete') throw new Error('AI response incomplete. Please try a smaller feature.');
    const output = (payload.output || []).flatMap(x => x.content || [])
      .filter(x => x.type === 'output_text').map(x => x.text).join('').trim();
    const cleaned = output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(cleaned);
  } finally { clearTimeout(timeout); }
}
function normalizeFile(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 230 ||
      value.includes('\\') || value.startsWith('/') || /^[a-z]:/i.test(value)) throw new Error('Invalid file path.');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[<>:"|?*]/.test(p))) throw new Error('Unsafe file path.');
  if (parts.some(p => ['.git', 'node_modules', '.ai-code-tutor', 'dist', 'build'].includes(p))) throw new Error('Protected file path.');
  if (parts.some(p => p.startsWith('.env'))) throw new Error('Environment files cannot be generated.');
  return parts.join('/');
}
async function ensureSafeTarget(project, relative) {
  const bits = relative.split('/');
  let current = project;
  for (const part of bits) {
    current = path.join(current, part);
    try {
      const entry = await fs.lstat(current);
      if (entry.isSymbolicLink()) throw new Error('Symlink paths cannot be modified.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const target = path.resolve(project, relative);
  if (!target.startsWith(project + path.sep)) throw new Error('Outside project directory.');
  return target;
}
async function context(project) {
  const entries = await fs.readdir(project, { withFileTypes: true });
  const names = entries.map(e => (e.isDirectory() ? e.name + '/' : e.name)).slice(0, 60);
  const candidates = ['package.json', 'src/App.tsx', 'src/App.jsx', 'src/app.ts', 'src/main.ts', 'lib/main.dart', 'index.html'];
  const existing = [];
  for (const file of candidates) {
    try {
      const target = await ensureSafeTarget(project, file);
      const stat = await fs.stat(target);
      if (stat.isFile() && stat.size < 18000) existing.push(`--- ${file}\n${await fs.readFile(target, 'utf8')}`);
    } catch { /* optional context */ }
  }
  return `Project entries:\n${names.join('\n')}\n\nExisting source:\n${existing.join('\n\n').slice(0, 25000)}`;
}
ipcMain.handle('mentor-ai:questions', async (_event, goal) => {
  const project = await root();
  if (typeof goal !== 'string' || goal.trim().length < 1 || goal.length > 4000) throw new Error('Describe your software goal in more detail.');
  await mentorMemory.record(project, 'user-goal', goal.trim());
  const data = await ai('You are a programming mentor. First decide if clarification is actually necessary. Ask ZERO questions when the task can be implemented using existing project conventions and sensible defaults. Ask 1 to 3 short, plain-Chinese questions ONLY if a missing decision would substantially change user-visible functionality or safety. Never ask about implementation details that you can decide yourself; never repeat decisions already in project context or history. Each question must offer 2 to 4 brief selectable answers, including an AI-recommended default when appropriate. Return ONLY JSON: {"questions":[]} when ready to implement, otherwise {"questions":[{"question":"short question","options":["choice 1","choice 2","AI decides"]}]}. No markdown.', `Goal: ${goal}\n${await mentorMemory.context(project)}`, 2200);
  const questions = Array.isArray(data.questions) ? data.questions.slice(0, 3).filter(q => q && typeof q.question === 'string' && Array.isArray(q.options)).map(q => ({ question: q.question.trim().slice(0, 450), options: [...new Set(q.options.filter(o => typeof o === 'string').map(o => o.trim()).filter(Boolean))].slice(0, 5) })).filter(q => q.question && q.options.length >= 2) : [];
  // Zero questions means implementation can proceed immediately.
  await mentorMemory.record(project, 'assistant-questions', questions.join(' | '));
  return { questions };
});
ipcMain.handle('mentor-ai:draft', async (event, args) => {
  const project = await root();
  const { goal, answers } = args || {};
  if (typeof goal !== 'string' || goal.length > 4000 || !Array.isArray(answers) || answers.length > 4 ||
      answers.some(a => typeof a !== 'string' || a.length > 3000)) throw new Error('Invalid requirements.');
  await mentorMemory.record(project, 'user-answers', answers.map((a, i) => (i + 1) + ': ' + a).join(' | '));
  const data = await ai('You are an IDE coding assistant. Produce working source code for the next small implementable feature of the user project. Use current project conventions. Do not invent installed packages. Return ONLY JSON with shape {"summary":"brief Chinese summary", "files":[{"path":"project-relative/path", "content":"complete UTF-8 file content"}]}. Generate 1-5 coherent files. Do not generate package lock files or secrets. Prefer editing existing entry points where required. No markdown or explanation outside JSON.', `Software goal: ${goal}\nAnswers:\n${answers.map((a,i)=>`${i+1}: ${a}`).join('\n')}\n\n${await mentorMemory.context(project)}`, 12000);
  if (!Array.isArray(data.files) || data.files.length < 1 || data.files.length > 5) throw new Error('AI returned invalid file list.');
  const seen = new Set();
  const files = [];
  for (const entry of data.files) {
    const rel = normalizeFile(entry.path);
    if (seen.has(rel) || typeof entry.content !== 'string' || Buffer.byteLength(entry.content, 'utf8') > 85000) throw new Error('Invalid or oversized generated file.');
    seen.add(rel);
    const target = await ensureSafeTarget(project, rel);
    let exists = false;
    try { exists = (await fs.stat(target)).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    files.push({ path: rel, content: entry.content, exists });
  }
  const id = randomUUID();
  drafts.set(event.sender.id, { id, project, files, goal: goal.trim(), summary: String(data.summary || ""), createdAt: Date.now() });
  await mentorMemory.record(project, 'assistant-plan', String(data.summary || '').slice(0, 1400));
  return { id, summary: String(data.summary || 'Code generated.').slice(0, 1500), files: files.map(f => ({ path: f.path, exists: f.exists })) };
});
ipcMain.handle('mentor-ai:apply', async (event, draftId, confirmedOverwrite) => {
  const draft = drafts.get(event.sender.id);
  const project = await root();
  if (!draft || draft.id !== draftId || project !== draft.project || Date.now() - draft.createdAt > 600000) throw new Error('Draft expired. Generate again.');
  const overwrites = draft.files.filter(f => f.exists).map(f => f.path);
  if (overwrites.length && confirmedOverwrite !== true) return { needsConfirmation: true, overwrites };
  // Revalidate every destination immediately before applying; never follow links.
  for (const file of draft.files) await ensureSafeTarget(project, file.path);
  const recordedFiles = [];
  for (const file of draft.files) {
    const target = await ensureSafeTarget(project, file.path);
    let before = null;
    try { before = await fs.readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, { encoding: 'utf8', flag: file.exists ? 'w' : 'wx' });
    recordedFiles.push({ path: file.path, ...changeHistory.summarize(before, file.content) });
  }
  await changeHistory.append(project, { goal: draft.goal || '', summary: draft.summary || '', files: recordedFiles });
  drafts.delete(event.sender.id);
  await mentorMemory.invalidate(project, draft.files.map(f => f.path));
  await mentorMemory.record(project, 'assistant-applied', draft.files.map(f => (f.exists ? 'modified ' : 'created ') + f.path).join(' | '));
  return { needsConfirmation: false, files: draft.files.map(f => f.path), firstFile: draft.files[0].path };
});

ipcMain.handle('mentor-change-history:list', async () => {
  const project = await root();
  return changeHistory.read(project);
});