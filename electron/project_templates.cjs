'use strict';

// Files are intentionally generated without running a shell or installing packages.
function buildProjectTemplateFiles(template, name) {
  if (template === 'empty') {
    return { 'README.md': `# ${name}\n\n在 Code Tutor Studio 中开始你的新项目。\n` };
  }
  if (template === 'vanilla') {
    return {
      'index.html': `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>Hello, ${name}!</h1>\n    <button id="hello">点击我</button>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
      'style.css': 'body { font-family: system-ui, sans-serif; margin: 3rem; background: #f4f7fc; color: #202940; }\nbutton { padding: .6rem 1rem; cursor: pointer; }\n',
      'script.js': 'document.querySelector("#hello")?.addEventListener("click", () => {\n  alert("Hello from Code Tutor Studio!");\n});\n',
      'README.md': `# ${name}\n\n直接在浏览器打开 index.html，或使用本地开发服务器。\n`,
    };
  }
  if (template !== 'react-ts' && template !== 'react-js') {
    throw new Error('不支持的项目模板。');
  }
  const ts = template === 'react-ts';
  const appPath = ts ? 'src/App.tsx' : 'src/App.jsx';
  const entryPath = ts ? 'src/main.tsx' : 'src/main.jsx';
  const files = {
    'package.json': JSON.stringify({
      name,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: { dev: 'vite', build: ts ? 'tsc -b && vite build' : 'vite build', preview: 'vite preview' },
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: {
        vite: '^7.0.0',
        '@vitejs/plugin-react': '^5.0.0',
        ...(ts ? { typescript: '~5.9.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', '@types/node': '^22.0.0' } : {}),
      },
    }, null, 2) + '\n',
    '.gitignore': 'node_modules\ndist\n.env.local\n',
    'index.html': `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/${entryPath}"></script>\n</body>\n</html>\n`,
    'vite.config.js': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`,
    [entryPath]: `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './style.css';\n\ncreateRoot(document.getElementById('root')${ts ? '!' : ''}).render(\n  <React.StrictMode><App /></React.StrictMode>,\n);\n`,
    [appPath]: `export default function App() {\n  return <main><h1>${name}</h1><p>开始编写你的 React 项目。</p></main>;\n}\n`,
    'src/style.css': 'body { margin: 0; font-family: system-ui, sans-serif; background: #f4f7fc; color: #202940; }\nmain { max-width: 760px; margin: 4rem auto; padding: 2rem; }\n',
    'README.md': `# ${name}\n\n首次启动：\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n依赖不会由 IDE 自动安装。\n`,
  };
  if (ts) {
    files['tsconfig.json'] = JSON.stringify({
      compilerOptions: {
        target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler',
        allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true,
        noEmit: true, jsx: 'react-jsx', strict: true, noUnusedLocals: true,
      }, include: ['src'],
    }, null, 2) + '\n';
    // Build does not use TS project references; tsc -b accepts the root tsconfig.
  }
  return files;
}

module.exports = { buildProjectTemplateFiles };
