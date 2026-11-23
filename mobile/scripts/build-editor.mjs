import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['editor-web/editor.ts'],
  bundle: true,
  minify: true,
  legalComments: 'inline',
  write: false,
  format: 'iife',
  target: 'chrome100',
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-local-editor\'; style-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
  '<style>html,body,#editor{height:100%;margin:0;background:#111a28}</style></head>' +
  '<body><main id="editor"></main><script nonce="local-editor">' + script + '</script></body></html>';
const require = createRequire(import.meta.url);
const libraries = [
  ['react', 'react', 'react.js'],
  ['client', 'react-dom/client', 'react-dom-client.js'],
  ['jsxRuntime', 'react/jsx-runtime', 'react-jsx-runtime.js'],
];
const browserRuntime = await build({
  absWorkingDir: fileURLToPath(root),
  stdin: {
    contents: libraries.map(([name, pkg]) => 'import * as ' + name + ' from ' + JSON.stringify(pkg) + '; export { ' + name + ' };').join('\n'),
    resolveDir: fileURLToPath(root),
  },
  bundle: true, minify: true, write: false, format: 'esm', platform: 'browser',
  legalComments: 'inline', define: { 'process.env.NODE_ENV': '"production"' },
});
const runtime = { '__ct/vendor.js': browserRuntime.outputFiles[0].text };
for (const [name, pkg, path] of libraries) {
  const keys = Object.keys(require(pkg)).filter(key => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && key !== 'default');
  runtime['__ct/' + path] = 'import {' + name + ' as lib} from "./vendor.js";\n' +
    'export default lib.default ?? lib;\nexport const {' + keys.join(',') + '} = lib;\n';
}
await writeFile(new URL('src/editor/generated.ts', root), 'export const editorHtml = ' + JSON.stringify(html) +
  ';\nexport const reactRuntime = ' + JSON.stringify(runtime) + ';\n');
