import { buildReactSnapshot, compileReactFile, createReactFiles, starterFiles } from './reactProject';
import type { ProjectFileSystem } from './workspace';

const project = { id: 'scope', name: 'Todo' };

function memoryFiles() {
  const contents = new Map<string, string>();
  const create = jest.fn(async (_id: string, parent: string, name: string, directory: boolean) => {
    const path = parent ? parent + '/' + name : name;
    if (!directory) contents.set(path, '');
    return path;
  });
  const read = jest.fn(async (_id: string, path: string) => {
    if (!contents.has(path)) throw new Error('Missing file: ' + path);
    return { text: contents.get(path)!, revision: path, readOnly: false };
  });
  const write = jest.fn(async (_id: string, path: string, revision: string, source: string) => {
    if (path !== revision || contents.get(path) !== '') throw new Error('File changed');
    contents.set(path, source);
    return revision;
  });
  const list = jest.fn(async (_id: string, path: string) =>
    [...contents.keys()].filter(file => file.startsWith(path + '/')).map(file => ({ path: file, directory: false })));
  return { contents, create, read, write, list };
}

test('scaffolds real editable files and compiles a bounded React snapshot without touching disk again', async () => {
  const fs = memoryFiles();
  const adapter = fs as unknown as ProjectFileSystem;
  await createReactFiles(adapter, project);
  expect(Object.fromEntries(fs.contents)).toEqual(starterFiles);
  fs.contents.set('src/credentials.ts', 'export const secret = "not part of the preview"');
  const built = await buildReactSnapshot(adapter, project, { '__ct/vendor.js': 'export {};' });
  expect(built['src/main.tsx']).toContain('import App from');
  expect(built['src/App.tsx']).toContain('react/jsx-runtime');
  expect(built['src/credentials.ts']).toBeUndefined();
  expect(built['index.html']).toContain('type="importmap"');
  expect(fs.write).toHaveBeenCalledTimes(Object.keys(starterFiles).length);
});

test('shows React syntax errors with the source path and line', () => {
  expect(() => compileReactFile('src/App.tsx', 'const App = () => <h1>')).toThrow(/src\/App\.tsx:1:/);
});
