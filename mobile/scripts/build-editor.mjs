import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
await writeFile(new URL('src/editor/generated.ts', root), 'export const editorHtml = ' + JSON.stringify(html) + ';\n');
