'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_LOG_CHARS = 12000;
const CREATE_TIMEOUT_MS = 180000;
const INSTALL_TIMEOUT_MS = 600000;

/** Run a framework-maintained scaffolder with fixed arguments only.
 * The parent folder is selected by the user; the project name is validated
 * before this function is called. Never interpolate user paths in a shell. */
async function scaffoldOfficialProject({ template, name, parent, root }) {
  const flutter = template === 'flutter';
  if (!flutter && template !== 'react-ts' && template !== 'react-js') {
    throw new Error('不支持的官方创建模板。');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(name)) {
    throw new Error('无效的项目名称。');
  }
  if (flutter && !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error('Flutter 项目名称必须符合 snake_case 规则。');
  }
  const args = flutter
    ? ['create', '--project-name', name, name]
    : ['create', 'vite@latest', name, '--', '--template', template === 'react-ts' ? 'react-ts' : 'react'];

  // The official generator creates only the initial project. Dependency
  // installation is a separate mandatory step before reporting success.
  await runCli(flutter ? 'flutter' : 'npm', args, parent, CREATE_TIMEOUT_MS, flutter ? 'Flutter 项目生成' : 'Vite 项目生成');
  const marker = path.join(root, flutter ? 'pubspec.yaml' : 'package.json');
  if (!await isFile(marker)) {
    throw new Error(`官方创建命令结束，但未找到 ${path.basename(marker)}。项目未完成：${root}`);
  }

  if (flutter) {
    // `flutter create` generally runs pub get itself, but explicitly verify
    // that the project can resolve packages before offering it as ready.
    await runCli('flutter', ['pub', 'get'], root, INSTALL_TIMEOUT_MS, 'Flutter 依赖安装');
    if (!await isFile(path.join(root, '.dart_tool', 'package_config.json'))) {
      throw new Error(`Flutter pub get 未生成依赖配置。项目尚未就绪：${root}`);
    }
  } else {
    await runCli('npm', ['install', '--no-audit', '--no-fund'], root, INSTALL_TIMEOUT_MS, 'React 依赖安装');
    for (const dependency of ['vite', '@vitejs/plugin-react', 'react', 'react-dom']) {
      if (!await isFile(path.join(root, 'node_modules', ...dependency.split('/'), 'package.json'))) {
        throw new Error(`npm install 结束，但缺少 ${dependency}。项目尚未就绪：${root}`);
      }
    }
  }
}

async function isFile(filePath) {
  try { return (await fs.stat(filePath)).isFile(); }
  catch { return false; }
}

function runCli(command, args, cwd, timeoutMs, stage) {
  const windows = process.platform === 'win32';
  const executable = windows ? (process.env.ComSpec || 'cmd.exe') : command;
  // All command arguments are fixed or constrained to [a-zA-Z0-9_-], and cwd
  // is passed separately, never embedded in a shell command.
  const finalArgs = windows ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`] : args;
  const env = { ...process.env, ...(command === 'npm' ? { npm_config_yes: 'true' } : {}) };
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(executable, finalArgs, {
        cwd, env, shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new Error(`${stage}无法启动：${error.message}`));
      return;
    }
    const record = (chunk) => {
      output = (output + chunk.toString('utf8')).slice(-MAX_LOG_CHARS);
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    timer.unref?.();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.once('error', (error) => {
      const hint = command === 'flutter'
        ? '请确认 Flutter SDK 已安装并配置 PATH。'
        : '请确认 Node.js / npm 已安装并配置 PATH。';
      finish(new Error(`${stage}失败。${hint}\n${error.message}`));
    });
    child.once('close', (code) => {
      if (timedOut) {
        finish(new Error(`${stage}超时。生成的目录已保留，请检查网络及 SDK；该项目未标记为创建成功。\n${output}`));
      } else if (code !== 0) {
        finish(new Error(`${stage}失败（退出码 ${code}）。生成的目录已保留，请检查错误后处理；该项目未标记为创建成功。\n${output}`));
      } else {
        finish();
      }
    });
  });
}

module.exports = { scaffoldOfficialProject };
