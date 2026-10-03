import { loadNafathConfig } from './nafath.config';
import { normalizeIp } from './nafath-ip.util';

const base = {
  NAFATH_ENABLED: 'true',
  NAFATH_BASE_URL: 'https://rabet-nafath.api.elm.sa/',
  NAFATH_APP_ID: 'app-id',
  NAFATH_APP_KEY: 'app-key',
  NAFATH_AUDIENCE: 'AQAR',
  NAFATH_SERVER_IP: '10.0.0.1',
  NAFATH_LINK_TOKEN_SECRET: 'link-secret',
  JWT_SECRET: 'jwt-secret',
};

describe('loadNafathConfig', () => {
  it('applies defaults and strips trailing slashes from the base URL', () => {
    const config = loadNafathConfig(base);

    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe('https://rabet-nafath.api.elm.sa');
    expect(config.service).toBe('Login');
    expect(config.callbackAllowedIps).toEqual(['195.170.180.7', '195.170.180.6']);
    expect(config.locale).toBe('ar');
    expect(config.decisionSeconds).toBe(60);
    expect(config.graceSeconds).toBe(20);
    expect(config.retentionDays).toBe(30);
  });

  it('lists every missing required variable when enabled', () => {
    expect(() => loadNafathConfig({ NAFATH_ENABLED: 'true' })).toThrow(
      'Missing Nafath config: NAFATH_BASE_URL, NAFATH_APP_ID, NAFATH_APP_KEY, NAFATH_AUDIENCE, NAFATH_SERVER_IP, NAFATH_LINK_TOKEN_SECRET',
    );
  });

  it('rejects a link-token secret equal to JWT_SECRET', () => {
    expect(() =>
      loadNafathConfig({ ...base, NAFATH_LINK_TOKEN_SECRET: 'jwt-secret' }),
    ).toThrow('NAFATH_LINK_TOKEN_SECRET must differ from JWT_SECRET');
  });

  it('skips validation when disabled', () => {
    expect(loadNafathConfig({}).enabled).toBe(false);
  });

  it('parses the allow-list, trimming and dropping blanks', () => {
    const config = loadNafathConfig({
      ...base,
      NAFATH_CALLBACK_ALLOWED_IPS: ' 1.1.1.1, ,2.2.2.2 ',
    });
    expect(config.callbackAllowedIps).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('falls back to defaults for invalid numbers and locale', () => {
    const config = loadNafathConfig({
      ...base,
      NAFATH_DECISION_SECONDS: 'abc',
      NAFATH_GRACE_SECONDS: '-5',
      NAFATH_LOCALE: 'fr',
    });
    expect(config.decisionSeconds).toBe(60);
    expect(config.graceSeconds).toBe(20);
    expect(config.locale).toBe('ar');
  });
});

describe('normalizeIp', () => {
  it('strips the IPv4-mapped IPv6 prefix', () => {
    expect(normalizeIp('::ffff:195.170.180.7')).toBe('195.170.180.7');
  });

  it('leaves plain addresses alone and maps undefined to empty string', () => {
    expect(normalizeIp('195.170.180.6')).toBe('195.170.180.6');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp(undefined)).toBe('');
  });
});
