'use strict';
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.ai-code-tutor']);
const sourceFiles = ['package.json', 'src/App.tsx', 'src/App.jsx', 'src/app.ts', 'src/main.ts', 'lib/main.dart', 'index.html'];
const cache = new Map();
function storePath(project) {
  const id = crypto.createHash('sha256').update(path.resolve(project).toLowerCase()).digest('hex');
  return path.join(app.getPath('userData'), 'mentor-conversations', id + '.json');
}
async function load(project) {
  const key = path.resolve(project);
  if (cache.has(key)) return cache.get(key);
  let doc = { version: 1, project: key, turns: [], files: {}, entries: [], entriesSignature: '' };
  try {
    const saved = JSON.parse(await fs.readFile(storePath(project), 'utf8'));
    if (saved.project === key && saved.version === 1) {
      doc = { ...doc, ...saved, turns: Array.isArray(saved.turns) ? saved.turns : [], files: saved.files || {} };
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Mentor memory read failed:', error.message); }
  cache.set(key, doc);
  return doc;
}
async function save(doc) {
  const target = storePath(doc.project);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.' + process.pid + '.tmp';
  await fs.writeFile(temp, JSON.stringify(doc), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, target);
}
async function record(project, role, content) {
  const doc = await load(project);
  doc.turns.push({ role, text: String(content).slice(0, 3500), at: new Date().toISOString() });
  doc.turns = doc.turns.slice(-36);
  await save(doc);
}
async function invalidate(project, filenames) {
  const doc = await load(project);
  for (const file of filenames) delete doc.files[file];
  doc.entriesSignature = '';
  await save(doc);
}
async function context(project, { refresh = false } = {}) {
  const doc = await load(project);
  const root = path.resolve(project);
  const listing = await fs.readdir(root, { withFileTypes: true });
  const entries = listing.filter(x => !ignored.has(x.name)).map(x => x.name + (x.isDirectory() ? '/' : '')).slice(0, 60);
  const snippets = [];
  for (const relative of sourceFiles) {
    const file = path.join(root, relative);
    try {
      const lstat = await fs.lstat(file);
      if (!lstat.isFile() || lstat.size > 18000) { delete doc.files[relative]; continue; }
      const signature = `${lstat.size}:${lstat.mtimeMs}`;
      let item = doc.files[relative];
      if (refresh || !item || item.signature !== signature) {
        const content = await fs.readFile(file, 'utf8');
        item = { signature, content };
        doc.files[relative] = item;
      }
      snippets.push(`--- ${relative}\n${item.content}`);
    } catch (error) { if (error.code !== 'ENOENT') console.warn('Mentor context file skipped:', relative, error.message); delete doc.files[relative]; }
  }
  doc.entries = entries;
  await save(doc);
  const history = doc.turns.slice(-16).map(x => `${x.role}: ${x.text}`).join('\n');
  return `Project entries:\n${entries.join('\n')}\n\nExisting source:\n${snippets.join('\n\n').slice(0, 25000)}\n\nPrevious conversation (same project, chronological):\n${history || '(none)'}\nUse this history to continue the user's work. Do not repeat questions already answered unless relevant files changed or clarification is essential.`;
}
module.exports = { context, record, invalidate, load };
