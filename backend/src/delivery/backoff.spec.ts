import { retryDelayMs } from './backoff';

describe('retryDelayMs', () => {
  it('grows exponentially and stays within [exp/2, exp]', () => {
    expect(retryDelayMs(1, 30_000, 3_600_000, () => 0)).toBe(15_000);
    expect(retryDelayMs(1, 30_000, 3_600_000, () => 1)).toBe(30_000);
    expect(retryDelayMs(3, 30_000, 3_600_000, () => 1)).toBe(120_000);
  });

  it('is capped', () => {
    expect(retryDelayMs(30, 30_000, 3_600_000, () => 1)).toBe(3_600_000);
  });
});
