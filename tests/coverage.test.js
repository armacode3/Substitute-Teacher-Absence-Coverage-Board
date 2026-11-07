import { describe, it, expect } from 'vitest';
import { coverageGaps } from '../src/coverage.js';

describe('linear coverage gap scan', () => {
  it('returns the entire window for no assignments', () => {
    expect(coverageGaps(0, 10, [])).toEqual([{ start_time: 0, end_time: 10 }]);
  });

  it('finds leading, multiple internal, and trailing gaps', () => {
    expect(coverageGaps(0, 10, [
      { start_time: 1, end_time: 2 }, { start_time: 3, end_time: 4 }, { start_time: 6, end_time: 9 }
    ])).toEqual([
      { start_time: 0, end_time: 1 }, { start_time: 2, end_time: 3 },
      { start_time: 4, end_time: 6 }, { start_time: 9, end_time: 10 }
    ]);
  });

  it('treats adjacent assignments as continuous coverage', () => {
    expect(coverageGaps(0, 10, [
      { start_time: 0, end_time: 4 }, { start_time: 4, end_time: 10 }
    ])).toEqual([]);
  });
});
