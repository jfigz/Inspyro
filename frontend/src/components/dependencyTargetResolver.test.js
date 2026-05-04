import { resolveDependencyTargetFromModel } from './dependencyTargetResolver';

function createModel(source) {
  const lines = source.split('\n');
  return {
    getLineContent(lineNumber) {
      return lines[lineNumber - 1] || '';
    },
    getWordAtPosition(position) {
      const line = lines[position.lineNumber - 1] || '';
      const columnIndex = Math.max(0, position.column - 1);
      const matches = [...line.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)];
      const match = matches.find((item) => (
        columnIndex >= item.index && columnIndex <= item.index + item[0].length
      ));
      if (!match) return null;
      return {
        word: match[0],
        startColumn: match.index + 1,
        endColumn: match.index + match[0].length + 1,
      };
    },
    getValueInRange(range) {
      if (range.startLineNumber !== range.endLineNumber) return '';
      const line = lines[range.startLineNumber - 1] || '';
      return line.slice(range.startColumn - 1, range.endColumn - 1);
    },
  };
}

describe('resolveDependencyTargetFromModel', () => {
  it('prefiere una seleccion explicita de simbolo', () => {
    const model = createModel('ratio = BeamModel.capacity_ratio()');

    const target = resolveDependencyTargetFromModel(model, { lineNumber: 1, column: 1 }, {
      selection: {
        startLineNumber: 1,
        startColumn: 9,
        endLineNumber: 1,
        endColumn: 33,
      },
    });

    expect(target).toEqual(expect.objectContaining({
      symbol: 'BeamModel.capacity_ratio',
      line: 1,
      column: 8,
    }));
  });

  it('resuelve el nombre de metodo cuando el cursor esta sobre def', () => {
    const model = createModel('def capacity_ratio(self) -> float:');

    const target = resolveDependencyTargetFromModel(model, { lineNumber: 1, column: 2 });

    expect(target).toEqual(expect.objectContaining({
      symbol: 'capacity_ratio',
      line: 1,
      column: 4,
    }));
  });

  it('resuelve el nombre de clase cuando el cursor esta sobre class', () => {
    const model = createModel('class BeamModel:');

    const target = resolveDependencyTargetFromModel(model, { lineNumber: 1, column: 2 });

    expect(target).toEqual(expect.objectContaining({
      symbol: 'BeamModel',
      line: 1,
      column: 6,
    }));
  });

  it('mantiene el token bajo cursor para referencias normales', () => {
    const model = createModel('ratio = self.flexural_capacity()');

    const target = resolveDependencyTargetFromModel(model, { lineNumber: 1, column: 10 });

    expect(target).toEqual(expect.objectContaining({
      symbol: 'self',
      line: 1,
      column: 8,
    }));
  });
});
