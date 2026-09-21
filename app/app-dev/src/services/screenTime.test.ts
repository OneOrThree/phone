import { selectionCount } from './screenTime';

describe('screenTime service', () => {
  it('counts every selected token type', () => {
    expect(selectionCount(null)).toBe(0);
    expect(selectionCount({ applications: 2, categories: 1, webDomains: 3 })).toBe(6);
  });
});
