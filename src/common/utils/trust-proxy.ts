/**
 * Parses the TRUST_PROXY env var for Express's `trust proxy` setting.
 * Returns undefined when the setting must be left alone.
 */
export function parseTrustProxy(
  value: string | undefined,
): number | string | undefined {
  const v = value?.trim();
  if (!v || v === '0' || v.toLowerCase() === 'false') return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  if (v.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY=true trusts client-supplied X-Forwarded-For; set the number of proxies in front of the app (e.g. 1) or a comma-separated list of proxy IPs/CIDRs',
    );
  }
  return v;
}
