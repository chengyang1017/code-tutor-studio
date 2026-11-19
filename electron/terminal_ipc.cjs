'use strict';
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const pty = require('node-pty');
const sessions = new Map();
function signal(sender, channel, data) {
  if (!sender.isDestroyed()) sender.send(channel, data);
}
function close(id) {
  const old = sessions.get(id);
  if (!old) return false;
  sessions.delete(id);
  try { old.kill(); } catch { /* already exited */ }
  return true;
}
ipcMain.handle('terminal:choose-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { title: '选择终端工作目录', properties: ['openDirectory', 'createDirectory'] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] || null);
});
ipcMain.handle('terminal:start', async (event, requestedRoot) => {
  if (typeof requestedRoot !== 'string' || !requestedRoot.trim()) throw new Error('请先选择工作目录');
  const root = path.resolve(requestedRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('终端工作目录必须是文件夹');
  const sender = event.sender;
  const id = sender.id;
  close(id);
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  // OSC 7 is emitted at each prompt, including after PowerShell 'cd'.
  // This is metadata for the terminal UI, not an additional shell command.
  const promptBootstrap = 'function global:prompt { ' +
    '$p = (Get-Location).ProviderPath; ' +
    '$u = [System.Uri]::new($p).AbsoluteUri; ' +
    '[Console]::Write([char]27 + "]7;" + $u + [char]7); ' +
    '"PS " + $p + "> " }';
  const args = isWindows
    ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', promptBootstrap]
    : [];
  // On Windows, node-pty uses ConPTY; unlike stdio pipes this is a real TTY.
  const child = pty.spawn(shell, args, {
    name: 'xterm-256color', cols: 100, rows: 24, cwd: root,
    env: { ...process.env, TERM: 'xterm-256color' },
    ...(isWindows ? { useConpty: true } : {}),
  });
  sessions.set(id, child);
  child.onData(data => signal(sender, 'terminal:data', { data }));
  child.onExit(({ exitCode, signal: exitSignal }) => {
    if (sessions.get(id) === child) sessions.delete(id);
    signal(sender, 'terminal:exit', { code: exitCode, signal: String(exitSignal ?? '') });
  });
  sender.once('destroyed', () => { if (sessions.get(id) === child) close(id); });
  return { cwd: root, shell: isWindows ? 'PowerShell' : path.basename(shell) };
});
ipcMain.handle('terminal:write', (event, input) => {
  const child = sessions.get(event.sender.id);
  if (!child) throw new Error('终端尚未启动');
  if (typeof input !== 'string' || input.length > 65536) throw new Error('终端输入无效');
  child.write(input);  // Raw key stream. NEVER append CRLF.
  return true;
});
ipcMain.handle('terminal:resize', (event, cols, rows) => {
  const child = sessions.get(event.sender.id);
  if (!child) return false;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 300) return false;
  child.resize(cols, rows);
  return true;
});
ipcMain.handle('terminal:stop', event => close(event.sender.id));