import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyObject,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { emailDepuisJwtCf, type OptionsJwtCf } from './identite.js';

const ISSUER = 'https://equipe.cloudflareaccess.com';
const AUD = 'aud-application';
const OPTIONS: OptionsJwtCf = { issuer: ISSUER, audience: AUD };
const KID = 'kid-test';

/**
 * Vérifie le cœur de l'option B1 : un JWT Cloudflare Access n'est accepté que si
 * sa **signature** (JWKS), son **issuer** (team domain) et son **aud**
 * (application) sont valides. Le JWKS est **local** (clé générée en test), donc
 * aucune dépendance réseau.
 */
describe('emailDepuisJwtCf', () => {
  let cle: KeyObject;
  let jwks: JWTVerifyGetKey;

  beforeAll(async () => {
    const paire = await generateKeyPair('RS256');
    cle = paire.privateKey;
    const jwk = await exportJWK(paire.publicKey);
    jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] });
  });

  /** Signe un JWT RS256 avec des claims surchargeables. */
  async function signer(
    claims: Record<string, unknown>,
    options?: { issuer?: string; audience?: string },
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(options?.issuer ?? ISSUER)
      .setAudience(options?.audience ?? AUD)
      .setExpirationTime('2h')
      .sign(cle);
  }

  it('extrait l’e-mail d’un JWT valide (signature + issuer + aud)', async () => {
    const jwt = await signer({ email: 'parent@test.fr' });
    await expect(emailDepuisJwtCf(jwt, OPTIONS, jwks)).resolves.toBe(
      'parent@test.fr',
    );
  });

  it('rejette un JWT dont l’audience ne correspond pas', async () => {
    const jwt = await signer(
      { email: 'parent@test.fr' },
      { audience: 'autre-app' },
    );
    await expect(emailDepuisJwtCf(jwt, OPTIONS, jwks)).rejects.toThrow();
  });

  it('rejette un JWT dont l’issuer ne correspond pas', async () => {
    const jwt = await signer(
      { email: 'parent@test.fr' },
      { issuer: 'https://pirate.cloudflareaccess.com' },
    );
    await expect(emailDepuisJwtCf(jwt, OPTIONS, jwks)).rejects.toThrow();
  });

  it('rejette un JWT valide mais sans claim « email »', async () => {
    const jwt = await signer({ sub: 'abc' });
    await expect(emailDepuisJwtCf(jwt, OPTIONS, jwks)).rejects.toThrow(/email/);
  });

  it('rejette une chaîne qui n’est pas un JWT', async () => {
    await expect(
      emailDepuisJwtCf('pas-un-jwt', OPTIONS, jwks),
    ).rejects.toThrow();
  });
});
