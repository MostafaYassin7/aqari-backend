export const NAFATH_CONFIG = Symbol('NAFATH_CONFIG');
export const NAFATH_JWT = Symbol('NAFATH_JWT');

export interface NafathConfig {
  enabled: boolean;
  baseUrl: string;
  appId: string;
  appKey: string;
  service: string;
  audience: string;
  serverIp: string;
  callbackAllowedIps: string[];
  locale: 'ar' | 'en';
  decisionSeconds: number;
  graceSeconds: number;
  linkTokenSecret: string;
  retentionDays: number;
}

type Env = Record<string, string | undefined>;

const REQUIRED = [
  'NAFATH_BASE_URL',
  'NAFATH_APP_ID',
  'NAFATH_APP_KEY',
  'NAFATH_AUDIENCE',
  'NAFATH_SERVER_IP',
  'NAFATH_LINK_TOKEN_SECRET',
] as const;

const DEFAULT_ALLOWED_IPS = '195.170.180.7,195.170.180.6';

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadNafathConfig(env: Env): NafathConfig {
  const enabled = env['NAFATH_ENABLED'] === 'true';

  if (enabled) {
    const missing = REQUIRED.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing Nafath config: ${missing.join(', ')}`);
    }
    if (env['NAFATH_LINK_TOKEN_SECRET'] === env['JWT_SECRET']) {
      throw new Error('NAFATH_LINK_TOKEN_SECRET must differ from JWT_SECRET');
    }
  }

  return {
    enabled,
    baseUrl: (env['NAFATH_BASE_URL'] ?? '').replace(/\/+$/, ''),
    appId: env['NAFATH_APP_ID'] ?? '',
    appKey: env['NAFATH_APP_KEY'] ?? '',
    service: env['NAFATH_SERVICE'] || 'Login',
    audience: env['NAFATH_AUDIENCE'] ?? '',
    serverIp: env['NAFATH_SERVER_IP'] ?? '',
    callbackAllowedIps: (env['NAFATH_CALLBACK_ALLOWED_IPS'] ?? DEFAULT_ALLOWED_IPS)
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    locale: env['NAFATH_LOCALE'] === 'en' ? 'en' : 'ar',
    decisionSeconds: positiveInt(env['NAFATH_DECISION_SECONDS'], 60),
    graceSeconds: positiveInt(env['NAFATH_GRACE_SECONDS'], 20),
    linkTokenSecret: env['NAFATH_LINK_TOKEN_SECRET'] ?? '',
    retentionDays: positiveInt(env['NAFATH_RETENTION_DAYS'], 30),
  };
}
