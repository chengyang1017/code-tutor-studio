'use strict';
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function location(project) {
  return path.join(path.resolve(project), '.code-tutor', 'history', 'changes.json');
}
function legacyLocation(project) {
  const id = crypto.createHash('sha256').update(path.resolve(project).toLowerCase()).digest('hex');
  return path.join(app.getPath('userData'), 'mentor-change-history', id + '.json');
}
async function readFileHistory(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Change history read failed:', file, error.message);
    return [];
  }
}
async function writeHistory(project, entries) {
  const target = location(project);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, target);
}
async function read(project) {
  const target = location(project);
  const local = await readFileHistory(target);
  const legacy = await readFileHistory(legacyLocation(project));
  if (!legacy.length) return local;
  const seen = new Set(local.map((entry) => entry.id));
  const merged = [...local];
  for (const entry of legacy) {
    if (!entry || seen.has(entry.id)) continue;
    merged.push(entry);
    seen.add(entry.id);
  }
  if (merged.length !== local.length) {
    merged.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    await writeHistory(project, merged);
  }
  return merged;
}
function summarize(before, after) {
  const a = before === null ? [] : before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let front = 0;
  while (front < a.length && front < b.length && a[front] === b[front]) front++;
  let back = 0;
  while (back < a.length-front && back < b.length-front && a[a.length-back-1] === b[b.length-back-1]) back++;
  const oldLines = a.slice(front,a.length-back);
  const newLines = b.slice(front,b.length-back);
  return {
    kind: before === null ? 'new' : 'modified',
    startLine: front+1,
    removedLines: oldLines.length,
    addedLines: newLines.length,
    removedPreview: oldLines.slice(0,12).join('\n').slice(0,1800),
    addedPreview: newLines.slice(0,12).join('\n').slice(0,1800),
    truncated: oldLines.length > 12 || newLines.length > 12,
  };
}
async function append(project, entry) {
  const history = await read(project);
  history.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry });
  await writeHistory(project, history);
}
module.exports = { read, append, summarize };
