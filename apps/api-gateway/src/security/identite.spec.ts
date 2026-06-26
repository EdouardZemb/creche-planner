import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyObject,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  emailDepuisJwtCf,
  foyerIdDemande,
  type OptionsJwtCf,
  type RequeteIdentifiable,
} from './identite.js';

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

/**
 * `foyerIdDemande` alimente la journalisation observe-only : il identifie le
 * foyer ciblé sans confondre un id de contrat avec un id de foyer.
 */
describe('foyerIdDemande', () => {
  function req(p: Partial<RequeteIdentifiable>): RequeteIdentifiable {
    return { headers: {}, ...p };
  }

  it('lit le filtre ?foyer= (contrats, coûts)', () => {
    expect(
      foyerIdDemande(
        req({ query: { foyer: 'f-123' }, url: '/api/v1/couts?foyer=f-123' }),
      ),
    ).toBe('f-123');
  });

  it('lit le param :id d’une route /foyers/:id', () => {
    expect(
      foyerIdDemande(
        req({ params: { id: 'f-9' }, url: '/api/v1/foyers/f-9/parents' }),
      ),
    ).toBe('f-9');
  });

  it('ignore un :id de contrat (route /contrats/:id, pas un foyerId)', () => {
    expect(
      foyerIdDemande(
        req({
          params: { id: 'c-7' },
          url: '/api/v1/contrats/c-7/plannings/2026-01',
        }),
      ),
    ).toBeUndefined();
  });

  it('renvoie undefined sans foyer ni id pertinent', () => {
    expect(foyerIdDemande(req({ url: '/api/v1/foyers' }))).toBeUndefined();
  });
});
