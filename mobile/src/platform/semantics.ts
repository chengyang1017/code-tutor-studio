import ts from 'typescript';
import { teachingScopes } from '../../../shared/teaching/teaching_code_validation';
import type { Diagnostic } from '../editor/protocol';

export const semantics = {
  scopes: teachingScopes,
  diagnostics(file: string, text: string): Diagnostic[] {
    if (!/\.[cm]?[jt]sx?$/i.test(file) || text.length > 100000) return [];
    const result = ts.transpileModule(text, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    return (result.diagnostics ?? []).filter(item => item.start !== undefined).map(item => {
      const from = Math.min(item.start!, text.length);
      return {
        from,
        to: Math.min(from + (item.length ?? 0), text.length),
        severity: item.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        message: ts.flattenDiagnosticMessageText(item.messageText, '\n'),
      };
    });
  },
};
