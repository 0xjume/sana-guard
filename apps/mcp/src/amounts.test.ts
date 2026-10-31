import { describe, expect, it } from 'vitest';
import { parseAmountString, stringifyJson } from './amounts.js';

describe('amounts', () => {
  it('parses integer strings without Number()', () => {
    expect(parseAmountString('9007199254740993')).toBe(9007199254740993n);
    expect(() => parseAmountString('1.5')).toThrow(/base-unit integer string/);
    expect(stringifyJson({ n: 9007199254740993n })).toContain('"9007199254740993"');
  });
});
