import { findUnitTokens } from './unitTokens';

describe('findUnitTokens', () => {
  it('detects units after strings containing hash characters', () => {
    const tokens = findUnitTokens('a = "#"; F = 14.5*kN');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].unit).toBe('kN');
    expect(tokens[0].lineNumber).toBe(1);
  });

  it('does not detect units inside string literals', () => {
    const tokens = findUnitTokens('a = "Force in kN"');
    expect(tokens).toEqual([]);
  });

  it('detects units before real comments and ignores comment body', () => {
    const tokens = findUnitTokens('F = 14.5*kN # comment MPa');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].unit).toBe('kN');
  });

  it('detects units after single-quoted strings with hash-like content', () => {
    const tokens = findUnitTokens("a = '# not comment'; sigma = 25*MPa");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].unit).toBe('MPa');
  });
});
