import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { NafathJwk } from './nafath.client';
import { NafathConfig } from './nafath.config';
import { NafathTokenError } from './nafath.errors';
import { NafathJwtVerifier } from './nafath-jwt.verifier';

function makeKey(kid: string): { jwk: NafathJwk; pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return {
    jwk: { ...exported, kid, alg: 'RS256', use: 'sig' },
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const signer = new JwtService();
const now = () => Math.floor(Date.now() / 1000);

function sign(pem: string, kid: string, claims: Record<string, unknown> = {}): string {
  return signer.sign(
    { aud: 'AQAR', iss: 'Nafath App', transId: 't-1', status: 'COMPLETED', exp: now() + 300, ...claims },
    { privateKey: pem, algorithm: 'RS256', keyid: kid },
  );
}

describe('NafathJwtVerifier', () => {
  const k1 = makeKey('k1');
  const k2 = makeKey('k2');
  const config = { audience: 'AQAR' } as NafathConfig;

  function makeVerifier(...jwksResponses: NafathJwk[][]) {
    const client = { getJwks: jest.fn() };
    for (const keys of jwksResponses) client.getJwks.mockResolvedValueOnce(keys);
    const verifier = new NafathJwtVerifier(client as never, new JwtService(), config);
    return { verifier, client };
  }

  it('verifies a valid token and returns its claims', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    const payload = await verifier.verify(sign(k1.pem, 'k1', { nin: '1000000001' }));
    expect(payload).toMatchObject({ transId: 't-1', status: 'COMPLETED', nin: '1000000001' });
  });

  it('caches keys between verifications', async () => {
    const { verifier, client } = makeVerifier([k1.jwk]);
    await verifier.verify(sign(k1.pem, 'k1'));
    await verifier.verify(sign(k1.pem, 'k1'));
    expect(client.getJwks).toHaveBeenCalledTimes(1);
  });

  it('refetches once when the kid is unknown (key rotation)', async () => {
    const { verifier, client } = makeVerifier([k1.jwk], [k1.jwk, k2.jwk]);
    await verifier.verify(sign(k1.pem, 'k1'));
    await expect(verifier.verify(sign(k2.pem, 'k2'))).resolves.toMatchObject({ transId: 't-1' });
    expect(client.getJwks).toHaveBeenCalledTimes(2);
  });

  it('rejects a kid that is still unknown after refetching', async () => {
    const { verifier, client } = makeVerifier([k1.jwk], [k1.jwk]);
    await verifier.verify(sign(k1.pem, 'k1'));
    await expect(verifier.verify(sign(k2.pem, 'k2'))).rejects.toThrow(NafathTokenError);
    expect(client.getJwks).toHaveBeenCalledTimes(2);
  });

  it('rejects a token signed by the wrong private key', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    await expect(verifier.verify(sign(k2.pem, 'k1'))).rejects.toThrow(NafathTokenError);
  });

  it('rejects the wrong audience', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    await expect(verifier.verify(sign(k1.pem, 'k1', { aud: 'OTHER_SP' }))).rejects.toThrow(NafathTokenError);
  });

  it('allows 60 s clock tolerance but rejects older expiry', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    await expect(verifier.verify(sign(k1.pem, 'k1', { exp: now() - 30 }))).resolves.toBeDefined();
    await expect(verifier.verify(sign(k1.pem, 'k1', { exp: now() - 120 }))).rejects.toThrow(NafathTokenError);
  });

  it('accepts nbf == exp as in the guide sample (within tolerance)', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    const t = now();
    await expect(verifier.verify(sign(k1.pem, 'k1', { nbf: t, exp: t }))).resolves.toBeDefined();
  });

  it('rejects non-RS256 tokens without fetching keys', async () => {
    const { verifier, client } = makeVerifier([k1.jwk]);
    const hs = signer.sign({ aud: 'AQAR' }, { secret: 'shared', algorithm: 'HS256', keyid: 'k1' });
    await expect(verifier.verify(hs)).rejects.toThrow('unsupported alg');
    await expect(verifier.verify('not-a-jwt')).rejects.toThrow(NafathTokenError);
    expect(client.getJwks).not.toHaveBeenCalled();
  });

  it('shares one JWKS fetch between concurrent cold verifications', async () => {
    const { verifier, client } = makeVerifier([k1.jwk]);
    await Promise.all([verifier.verify(sign(k1.pem, 'k1')), verifier.verify(sign(k1.pem, 'k1'))]);
    expect(client.getJwks).toHaveBeenCalledTimes(1);
  });
});
