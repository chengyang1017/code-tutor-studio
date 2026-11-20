import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { build } from 'vite';

const outDir = await mkdtemp(join(tmpdir(), 'teaching-editor-test-'));
try {
  await build({
    configFile: false,
    publicDir: false,
    base: './',
    logLevel: 'error',
    build: { outDir, reportCompressedSize: false, rollupOptions: { input: 'tests/fixtures/teaching_editor.html' } },
  });
  const harness = fileURLToPath(new URL('./teaching_editor.electron.cjs', import.meta.url));
  const page = join(outDir, 'tests', 'fixtures', 'teaching_editor.html');
  const child = spawn(electron, [harness, page, outDir], { stdio: 'inherit', timeout: 60000 });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal || code !== 0) console.error(`Electron fixture exited with ${signal ?? `status ${code}`}.`);
      resolve(signal ? 1 : code);
    });
  });
} finally {
  await rm(outDir, { recursive: true, force: true, maxRetries: 5 });
}
