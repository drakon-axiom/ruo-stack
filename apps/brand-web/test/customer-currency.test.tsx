import { expect, it } from 'vitest';
import { dollars } from '../src/screens/customers/types.js';
it.each([
  [0, '$0.00'], [1, '$0.01'], [1099, '$10.99'], [-1, '$-0.01'],
  [Number.MAX_SAFE_INTEGER - 1, '$90071992547409.90'],
  [-(Number.MAX_SAFE_INTEGER - 1), '$-90071992547409.90'],
  [Number.MAX_SAFE_INTEGER, '$90071992547409.91'],
  [-Number.MAX_SAFE_INTEGER, '$-90071992547409.91'],
])('formats %s cents exactly', (cents, expected) => {
  expect(dollars(cents)).toBe(expected);
});
