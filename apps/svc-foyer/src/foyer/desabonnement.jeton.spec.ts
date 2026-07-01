import { describe, expect, it } from 'vitest';
import { signerJeton, verifierJeton } from './desabonnement.jeton.js';

/**
 * Jeton de désabonnement one-click (RFC 8058) : la signature HMAC rejette tout
 * jeton forgé, altéré ou expiré **avant** tout accès base — première ligne de
 * défense contre l'énumération. Tests purs (pas d'infra).
 */
const SECRET = 'secret-de-test';
const JTI = '11111111-1111-4111-8111-111111111111';
const MAINTENANT = new Date('2026-07-01T12:00:00Z');
const DEMAIN = Math.floor(new Date('2026-07-02T12:00:00Z').getTime() / 1000);
const HIER = Math.floor(new Date('2026-06-30T12:00:00Z').getTime() / 1000);

describe('jeton de désabonnement', () => {
  it('signe puis vérifie une charge valide (aller-retour)', () => {
    const jeton = signerJeton({ jti: JTI, exp: DEMAIN }, SECRET);

    const charge = verifierJeton(jeton, SECRET, MAINTENANT);

    expect(charge).toEqual({ jti: JTI, exp: DEMAIN });
  });

  it('rejette une signature altérée (dernier caractère modifié)', () => {
    const jeton = signerJeton({ jti: JTI, exp: DEMAIN }, SECRET);
    const altere = jeton.slice(0, -1) + (jeton.endsWith('A') ? 'B' : 'A');

    expect(verifierJeton(altere, SECRET, MAINTENANT)).toBeNull();
  });

  it('rejette une charge modifiée (jti réécrit ⇒ signature invalide)', () => {
    const jeton = signerJeton({ jti: JTI, exp: DEMAIN }, SECRET);
    const sig = jeton.split('.')[1] ?? '';
    const autrePayload = Buffer.from(
      JSON.stringify({
        jti: '99999999-9999-4999-8999-999999999999',
        exp: DEMAIN,
      }),
      'utf8',
    ).toString('base64url');

    expect(
      verifierJeton(`${autrePayload}.${sig}`, SECRET, MAINTENANT),
    ).toBeNull();
  });

  it('rejette un jeton signé avec un autre secret', () => {
    const jeton = signerJeton({ jti: JTI, exp: DEMAIN }, 'autre-secret');

    expect(verifierJeton(jeton, SECRET, MAINTENANT)).toBeNull();
  });

  it('rejette un jeton expiré', () => {
    const jeton = signerJeton({ jti: JTI, exp: HIER }, SECRET);

    expect(verifierJeton(jeton, SECRET, MAINTENANT)).toBeNull();
  });

  it('rejette un jeton malformé (pas deux segments)', () => {
    expect(verifierJeton('nimportequoi', SECRET, MAINTENANT)).toBeNull();
    expect(verifierJeton('a.b.c', SECRET, MAINTENANT)).toBeNull();
    expect(verifierJeton('', SECRET, MAINTENANT)).toBeNull();
  });
});
