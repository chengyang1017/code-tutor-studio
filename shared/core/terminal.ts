export function isClearCommand(input: string): boolean {
  return ['cls', 'clear', 'clear-host'].includes(input.trim().toLowerCase());
}
