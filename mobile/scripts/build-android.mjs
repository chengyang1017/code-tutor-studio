import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const android = fileURLToPath(new URL('../android/', import.meta.url));
const windows = process.platform === 'win32';

function run(command, args, cwd) {
  const options = { cwd, stdio: 'inherit' };
  const result = windows
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], options)
    : spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'editor'], root);
run('npm', ['run', 'prebuild:android'], root);
run(windows ? 'gradlew.bat' : './gradlew', [':app:assembleDebug', '-PcodeTutorStandalone=true'], android);
