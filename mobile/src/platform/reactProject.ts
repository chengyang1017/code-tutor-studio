import ts from 'typescript';
import { isSensitivePath } from '../../../shared/teaching/session';
import type { Project, ProjectFileSystem } from './workspace';

export const starterFiles: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({
    name: 'code-tutor-react-project', private: true, type: 'module',
    scripts: { dev: 'vite --host 127.0.0.1', build: 'tsc --noEmit && vite build' },
    dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
    devDependencies: { '@types/react': '^19.1.0', '@types/react-dom': '^19.1.0', typescript: '~5.9.2', vite: '^7.0.0' },
    codeTutorLocalPreview: 1,
  }, null, 2) + '\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    jsx: 'react-jsx', strict: true, noEmit: true,
  }, include: ['src'] }, null, 2) + '\n',
  'index.html': '<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>React Todo</title><link rel="stylesheet" href="/src/style.css"></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n',
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\n\nconst root = document.getElementById('root');\nif (root) createRoot(root).render(<App />);\n",
  'src/App.tsx': 'function App() {\n  return <h1>Todo List</h1>;\n}\n\nexport default App;\n',
  'src/style.css': 'body { margin: 2rem; font-family: system-ui, sans-serif; }\n',
};

export async function createReactFiles(fs: ProjectFileSystem, project: Project) {
  const src = await fs.create(project.id, '', 'src', true);
  if (src !== 'src') throw new Error('存储提供程序调整了 src 目录名，模板尚未完整创建');
  for (const [path, source] of Object.entries(starterFiles)) {
    const slash = path.lastIndexOf('/');
    const actual = await fs.create(project.id, slash < 0 ? '' : path.slice(0, slash), path.slice(slash + 1), false);
    if (actual !== path) throw new Error('存储提供程序调整了模板文件名：' + actual);
    const file = await fs.read(project.id, path);
    if (file.text) throw new Error('发现已有文件内容：' + path);
    await fs.write(project.id, path, file.revision, source);
  }
}

export function compileReactFile(file: string, source: string) {
  const result = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
  });
  const error = result.diagnostics?.find(value => value.category === ts.DiagnosticCategory.Error);
  if (error) {
    const point = error.file?.getLineAndCharacterOfPosition(error.start ?? 0);
    const position = point ? ':' + (point.line + 1) + ':' + (point.character + 1) : '';
    throw new Error(file + position + ' · ' + ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }
  return result.outputText;
}

const imports = {
  react: '/__ct/react.js',
  'react-dom/client': '/__ct/react-dom-client.js',
  'react/jsx-runtime': '/__ct/react-jsx-runtime.js',
};

export async function buildReactSnapshot(fs: ProjectFileSystem, project: Project, runtime: Readonly<Record<string, string>>) {
  const manifest = JSON.parse((await fs.read(project.id, 'package.json')).text);
  if (!manifest || manifest.codeTutorLocalPreview !== 1) {
    throw new Error('此项目没有启用 Code Tutor React 模板预览。请在开发环境运行 Vite，或预览构建产物。');
  }
  const html = (await fs.read(project.id, 'index.html')).text;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!head) throw new Error('index.html 缺少 <head>，无法添加本地 React 导入映射');
  const position = head.index + head[0].length;
  const assets: Record<string, string> = {
    ...runtime,
    'index.html': html.slice(0, position) + '<script type="importmap">' + JSON.stringify({ imports }) + '</script>' + html.slice(position),
  };
  const queue = ['src'];
  let count = 0;
  let sourceLength = html.length;
  while (queue.length) {
    const directory = queue.pop()!;
    for (const entry of await fs.list(project.id, directory)) {
      if (!/^src\/(?:[\w.-]+\/)*[\w.-]+$/.test(entry.path) ||
          entry.path.split('/').some(part => part.startsWith('.')) || isSensitivePath(entry.path)) continue;
      if (++count > 64) throw new Error('模板预览最多读取 src 下 64 个条目');
      if (entry.directory) {
        queue.push(entry.path);
      } else if (/\.(?:[jt]sx?|mjs|css)$/.test(entry.path)) {
        const source = (await fs.read(project.id, entry.path)).text;
        sourceLength += source.length;
        if (sourceLength > 400000) throw new Error('模板预览源码总量超过上限');
        assets[entry.path] = entry.path.endsWith('.css') ? source : compileReactFile(entry.path, source);
      }
    }
  }
  if (!assets['src/main.tsx']) throw new Error('模板预览缺少 src/main.tsx');
  return assets;
}
