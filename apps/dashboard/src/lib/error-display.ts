export function ruleNameFromCode(code: string): string {
  const match = code.match(/^(?:SG_)?E0?\d+_(.+)$/i);
  if (!match) {
    return code;
  }
  return match[1]
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
