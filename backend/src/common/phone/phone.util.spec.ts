import { maskPhone, normalizePhone } from './phone.util';

describe('normalizePhone', () => {
  it.each([
    ['8971775506', '+918971775506'],
    ['89717 75506', '+918971775506'],
    ['+91 89717-75506', '+918971775506'],
    ['0091 8971775506', '+918971775506'],
    ['08971775506', '+918971775506'],
    ['+1 415 555 2671', '+14155552671'],
  ])('normalizes %s', (input, e164) => {
    expect(normalizePhone(input)?.e164).toBe(e164);
  });

  it.each(['', '12345', 'abc', '+91 12345 67890', '+91 80 2222 3333', '9'.repeat(30)])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('masks numbers', () => {
    expect(maskPhone('+918971775506')).toBe('+91 ••••••5506');
  });
});
