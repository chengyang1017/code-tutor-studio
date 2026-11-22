import type { TeachingDiagnostic, TeachingStepLocation } from './teaching_location';

export type TeachingMode = 'next' | 'reference' | 'verify';
export type TeachingVerification = { passed: boolean; feedback: string };
export type TeachingSession = {
  goal: string;
  completed: number;
  paused: boolean;
  step?: TeachingStepLocation;
};
export type TeachingRequest = {
  mode: TeachingMode;
  session: TeachingSession;
  files: string[];
  source?: { file: string; text: string; selection?: { from: number; to: number } };
};

export function isProjectPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !/[\\:\u0000-\u001f\u007f]/.test(value) &&
    value.split('/').every(part => part && part !== '..' && part !== '.');
}

export function isSensitivePath(path: string): boolean {
  return path.split('/').some(part => /^(?:\.env(?:\..*)?|\.git|\.npmrc|\.pypirc|\.ssh|id_rsa|id_ed25519|.*\.(?:pem|key|jks|keystore|pfx|p12)|.*(?:credential|secret|password).*)$/i.test(part));
}

export function isTeachingStep(value: unknown): value is TeachingStepLocation {
  if (!value || typeof value !== 'object') return false;
  const step = value as Partial<TeachingStepLocation>;
  return isProjectPath(step.file) &&
    typeof step.title === 'string' && step.title.length > 0 && step.title.length <= 300 &&
    typeof step.instruction === 'string' && step.instruction.length > 0 && step.instruction.length <= 6000 &&
    (step.anchor === undefined || (typeof step.anchor === 'string' && step.anchor.length <= 12000)) &&
    (step.scope === undefined || (typeof step.scope === 'string' && step.scope.length <= 600)) &&
    (step.line === undefined || (Number.isSafeInteger(step.line) && step.line > 0));
}

export function isTeachingVerification(value: unknown): value is TeachingVerification {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<TeachingVerification>;
  return typeof result.passed === 'boolean' && typeof result.feedback === 'string' && result.feedback.length <= 6000;
}

export const teachingDiagnosticText: Record<TeachingDiagnostic['kind'], string> = {
  'original-not-found': '找不到原文',
  ambiguous: '找到多个候选位置，无法确定修改目标',
  'already-complete': '这段代码已经完成',
  'unsupported-range': '修改范围不受支持',
  'invalid-ai-data': 'AI 返回数据不合法',
};
