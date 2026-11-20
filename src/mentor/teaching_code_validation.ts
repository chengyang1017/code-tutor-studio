import ts from 'typescript';
import type { TeachingEdit } from './teaching_completion';
import type { TeachingScope } from './teaching_location';

const scriptFile = /\.[cm]?[jt]sx?$/i;

export function teachingScopes(file: string, source: string): TeachingScope[] {
  if (!scriptFile.test(file)) return [];
  const tree = ts.createSourceFile(file, source.replace(/\r\n?/g, '\n'), ts.ScriptTarget.Latest, true);
  const scopes: TeachingScope[] = [];

  function visit(node: ts.Node, owner: string): void {
    if (ts.isClassLike(node) && node.name) owner += `${node.name.text}.`;
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const parent = node.parent;
      const name = node.name ?? (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ||
        ts.isPropertyDeclaration(parent) ? parent.name : undefined);
      if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
        const qualified = owner + name.text;
        scopes.push({ name: qualified, start: node.getStart(tree), end: node.getEnd() });
        owner = `${qualified}.`;
      }
    }
    node.forEachChild(child => visit(child, owner));
  }

  visit(tree, '');
  return scopes;
}

function duplicateBindings(source: ts.SourceFile): Map<string, number> {
  const duplicates = new Map<string, number>();

  function declare(name: ts.BindingName | undefined, scope: Set<string>): void {
    if (!name) return;
    if (!ts.isIdentifier(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) declare(element.name, scope);
      }
      return;
    }
    if (scope.has(name.text)) duplicates.set(name.text, (duplicates.get(name.text) ?? 0) + 1);
    scope.add(name.text);
  }

  function visit(node: ts.Node, scope: Set<string>): void {
    if (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) ||
        ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      declare(node.name, scope);
    }
    const childScope = ts.isBlock(node) || ts.isModuleBlock(node) || ts.isForStatement(node) ||
      ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isCaseBlock(node) ? new Set<string>() : scope;
    node.forEachChild(child => visit(child, childScope));
  }

  visit(source, new Set());
  return duplicates;
}

export function isSafeTeachingCode(file: string, edit: TeachingEdit): boolean {
  const modified = edit.before + edit.insertText + edit.after;
  if (scriptFile.test(file)) {
    const updated = ts.createSourceFile(file, modified, ts.ScriptTarget.Latest, true);
    // createSourceFile exposes parser diagnostics on the parsed SourceFile.
    const parsed = updated as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
    if (parsed.parseDiagnostics.length > 0) return false;

    const previous = ts.createSourceFile(file, edit.before + edit.original + edit.after, ts.ScriptTarget.Latest, true);
    const existingDuplicates = duplicateBindings(previous);
    if (Array.from(duplicateBindings(updated)).some(([name, count]) => count > (existingDuplicates.get(name) ?? 0))) {
      return false;
    }
    if (!edit.insertText) return Boolean(edit.original);

    // A line of prose or a standalone word can parse as an expression via ASI.
    // Check that the changed span contains a syntax token outside comments.
    let hasBareWord = false;
    let hasCode = false;
    const start = edit.before.length;
    const end = start + edit.insertText.length;
    function check(node: ts.Node): void {
      if (node.end <= start || node.getStart(updated) >= end ||
          (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)) return;
      if (ts.isExpressionStatement(node) && ts.isIdentifier(node.expression)) hasBareWord = true;
      const children = node.getChildren(updated);
      if (children.length > 0) children.forEach(check);
      else if (node.end > node.getStart(updated)) hasCode = true;
    }
    check(updated);
    return hasCode && !hasBareWord;
  }

  if (/\.json$/i.test(file)) {
    try { JSON.parse(modified); return true; }
    catch { return false; }
  }

  // Without a parser, require recognisable code syntax in the changed lines.
  const start = edit.before.lastIndexOf('\n') + 1;
  const nextBreak = edit.after.indexOf('\n');
  const lines = edit.before.slice(start) + (edit.insertText || edit.original) +
    (nextBreak < 0 ? edit.after : edit.after.slice(0, nextBreak));
  return /[=;{}()[\]<>]|^\s*(?:import|from|return|break|continue|pass|raise)\b/m.test(lines) &&
    !/^\s*(?:\p{L}+[ \t]+){3}\p{L}+[.!：:]?\s*$/mu.test(lines);
}
