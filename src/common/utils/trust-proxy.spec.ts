import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '   ', 'false', 'FALSE', '0', ' 0 '])(
    'leaves trust proxy unset for %p',
    (value) => {
      expect(parseTrustProxy(value)).toBeUndefined();
    },
  );

  it('parses a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it.each(['true', 'TRUE', ' True '])('rejects %p', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY=true/);
  });

  it('passes an IP/CIDR list through trimmed', () => {
    expect(parseTrustProxy(' 10.0.0.0/8, 172.16.0.1 ')).toBe(
      '10.0.0.0/8, 172.16.0.1',
    );
  });
});
