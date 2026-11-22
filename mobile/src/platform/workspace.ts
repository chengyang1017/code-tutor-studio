import { requireNativeModule } from 'expo';

export type Project = { id: string; name: string };
export type Entry = { path: string; directory: boolean };
export type FileSnapshot = { text: string; revision: string; readOnly: boolean };
export type TerminalEvent =
  | { id: string; kind: 'output'; text: string }
  | { id: string; kind: 'exit'; code: number };

export interface ProjectFileSystem {
  pick(name: string | null): Promise<Project | null>;
  restore(): Promise<Project | null>;
  list(id: string, path: string): Promise<Entry[]>;
  read(id: string, path: string): Promise<FileSnapshot>;
  write(id: string, path: string, revision: string, text: string): Promise<string>;
  create(id: string, parent: string, name: string, directory: boolean): Promise<string>;
  rename(id: string, path: string, name: string): Promise<void>;
  delete(id: string, path: string, confirmed: boolean): Promise<void>;
  getPreferences(): Promise<string | null>;
  putPreferences(data: string): Promise<void>;
  fingerprint(text: string): Promise<string>;
  getState(id: string): Promise<string | null>;
  putState(id: string, state: string): Promise<void>;
}

export interface TerminalAdapter {
  terminalDirectory(): Promise<string>;
  run(id: string, command: string, confirmed: boolean): Promise<void>;
  stop(): Promise<void>;
  addListener(name: 'terminalEvent', listener: (event: TerminalEvent) => void): { remove(): void };
}

export interface LocalExecutionAdapter {
  preview(id: string, confirmed: boolean): Promise<string>;
  stopPreview(): Promise<void>;
  validateRemotePreview(url: string): Promise<string>;
}

export const workspace = requireNativeModule<ProjectFileSystem & TerminalAdapter & LocalExecutionAdapter>('TutorWorkspace');
