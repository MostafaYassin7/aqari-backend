/** Express reports IPv4 clients on dual-stack sockets as "::ffff:a.b.c.d". */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}
