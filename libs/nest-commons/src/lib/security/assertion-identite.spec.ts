import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DUREE_VIE_ASSERTION_S,
  ENTETE_ASSERTION,
  TOLERANCE_DERIVE_S,
  VERSION_ASSERTION,
  entetesAssertionMachine,
  signerAssertion,
  verifierAssertion,
} from './assertion-identite.js';

const SECRET = 'secret-de-test-assertion';
const T0 = new Date('2026-07-17T10:00:00.000Z');

/** Instant décalé de `secondes` par rapport à `T0`. */
function a(secondes: number): Date {
  return new Date(T0.getTime() + secondes * 1000);
}

describe('signerAssertion / verifierAssertion', () => {
  it('signe et vérifie une assertion parent (nominal)', () => {
    const jeton = signerAssertion(
      { email: 'parent@test.fr', foyers: ['f-1', 'f-2'], admin: false },
      SECRET,
      T0,
    );
    const charge = verifierAssertion(jeton, SECRET, a(5));
    expect(charge).not.toBeNull();
    expect(charge?.v).toBe(VERSION_ASSERTION);
    expect(charge?.email).toBe('parent@test.fr');
    expect(charge?.foyers).toEqual(['f-1', 'f-2']);
    expect(charge?.admin).toBe(false);
    expect(charge?.machine).toBeUndefined();
    expect(charge?.exp).toBe(charge!.iat + DUREE_VIE_ASSERTION_S);
  });

  it('signe et vérifie une assertion machine (nominal)', () => {
    const jeton = signerAssertion({ machine: 'api-gateway' }, SECRET, T0);
    const charge = verifierAssertion(jeton, SECRET, a(1));
    expect(charge?.machine).toBe('api-gateway');
    expect(charge?.email).toBeUndefined();
    expect(charge?.foyers).toBeUndefined();
  });

  it('omet foyers/admin absents d’une assertion parent', () => {
    const jeton = signerAssertion({ email: 'p@test.fr' }, SECRET, T0);
    const charge = verifierAssertion(jeton, SECRET, a(1));
    expect(charge?.email).toBe('p@test.fr');
    expect(charge).not.toHaveProperty('foyers');
    expect(charge).not.toHaveProperty('admin');
  });

  it('rejette une assertion expirée au-delà de la tolérance', () => {
    const jeton = signerAssertion({ machine: 'api-gateway' }, SECRET, T0);
    // exp = T0 + 60 s ; au-delà de exp + tolérance (60 + 30 = 90) → rejet.
    expect(
      verifierAssertion(
        jeton,
        SECRET,
        a(DUREE_VIE_ASSERTION_S + TOLERANCE_DERIVE_S + 1),
      ),
    ).toBeNull();
  });

  it('tolère une dérive d’horloge dans la fenêtre (juste après exp)', () => {
    const jeton = signerAssertion({ machine: 'api-gateway' }, SECRET, T0);
    // 5 s après exp mais dans la tolérance de 30 s → accepté.
    const charge = verifierAssertion(
      jeton,
      SECRET,
      a(DUREE_VIE_ASSERTION_S + 5),
    );
    expect(charge?.machine).toBe('api-gateway');
  });

  it('tolère une horloge émettrice en avance dans la tolérance', () => {
    const jeton = signerAssertion({ machine: 'api-gateway' }, SECRET, T0);
    // Vérificateur 20 s AVANT iat (émetteur en avance) mais < tolérance → accepté.
    expect(verifierAssertion(jeton, SECRET, a(-20))?.machine).toBe(
      'api-gateway',
    );
  });

  it('rejette une assertion émise trop loin dans le futur (au-delà de la tolérance)', () => {
    const jeton = signerAssertion({ machine: 'api-gateway' }, SECRET, T0);
    expect(
      verifierAssertion(jeton, SECRET, a(-(TOLERANCE_DERIVE_S + 1))),
    ).toBeNull();
  });

  it('rejette une signature falsifiée (secret différent)', () => {
    const jeton = signerAssertion({ email: 'p@test.fr' }, SECRET, T0);
    expect(verifierAssertion(jeton, 'autre-secret', a(1))).toBeNull();
  });

  it('rejette un jeton dont le payload a été altéré (signature invalide)', () => {
    const jeton = signerAssertion({ email: 'p@test.fr' }, SECRET, T0);
    const [, sig] = jeton.split('.');
    const forge = Buffer.from(
      JSON.stringify({ v: 1, machine: 'intrus', iat: 0, exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url');
    expect(verifierAssertion(`${forge}.${sig}`, SECRET, a(1))).toBeNull();
  });

  it('rejette un jeton malformé (pas deux parties)', () => {
    expect(verifierAssertion('pas-de-point', SECRET, T0)).toBeNull();
    expect(verifierAssertion('a.b.c', SECRET, T0)).toBeNull();
    expect(verifierAssertion('.', SECRET, T0)).toBeNull();
  });

  it('rejette un payload mixte email + machine (invariant XOR)', () => {
    // Forge un payload avec email ET machine, signé avec le bon secret.
    const iat = Math.floor(T0.getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        email: 'p@test.fr',
        machine: 'api-gateway',
        iat,
        exp: iat + 60,
      }),
      'utf8',
    ).toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(payload)
      .digest()
      .toString('base64url');
    expect(verifierAssertion(`${payload}.${sig}`, SECRET, a(1))).toBeNull();
  });

  it('rejette un payload sans email ni machine', () => {
    const iat = Math.floor(T0.getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ v: 1, iat, exp: iat + 60 }),
      'utf8',
    ).toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(payload)
      .digest()
      .toString('base64url');
    expect(verifierAssertion(`${payload}.${sig}`, SECRET, a(1))).toBeNull();
  });

  it('rejette une mauvaise version de payload', () => {
    const iat = Math.floor(T0.getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ v: 2, machine: 'x', iat, exp: iat + 60 }),
      'utf8',
    ).toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(payload)
      .digest()
      .toString('base64url');
    expect(verifierAssertion(`${payload}.${sig}`, SECRET, a(1))).toBeNull();
  });

  it('rejette des foyers non homogènes (type invalide)', () => {
    const iat = Math.floor(T0.getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        email: 'p@x',
        foyers: ['f', 3],
        iat,
        exp: iat + 60,
      }),
      'utf8',
    ).toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(payload)
      .digest()
      .toString('base64url');
    expect(verifierAssertion(`${payload}.${sig}`, SECRET, a(1))).toBeNull();
  });
});

describe('entetesAssertionMachine', () => {
  it('produit un en-tête x-assertion-identite signé pour un service', () => {
    const entetes = entetesAssertionMachine('svc-tarification', SECRET, T0);
    const jeton = entetes[ENTETE_ASSERTION];
    expect(jeton).toBeDefined();
    expect(verifierAssertion(jeton!, SECRET, a(1))?.machine).toBe(
      'svc-tarification',
    );
  });

  it('renvoie un objet vide si le secret est absent (mode legacy)', () => {
    expect(entetesAssertionMachine('svc-tarification', undefined, T0)).toEqual(
      {},
    );
  });
});
