import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../src/js/utils/formatters.js';

test('csvCell neutralizes spreadsheet formula injection and escapes quotes', () => {
  assert.equal(csvCell('eco'), '"eco"');
  assert.equal(csvCell('Escherichia "coli"'), '"Escherichia ""coli"""');
  assert.equal(csvCell('=CMD|"/C calc"!A0'), '"\'=CMD|""/C calc""!A0"');
  assert.equal(csvCell('+1+1'), '"\'+1+1"');
  assert.equal(csvCell('-1+1'), '"\'-1+1"');
  assert.equal(csvCell('@SUM(1,2)'), '"\'@SUM(1,2)"');
  assert.equal(csvCell(null), '""');
});
