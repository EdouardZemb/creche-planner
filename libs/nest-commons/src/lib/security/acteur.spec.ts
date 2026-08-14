import { describe, expect, it } from 'vitest';
import {
  ACTEUR_INCONNU,
  acteurDepuisAssertion,
  libelleActeur,
} from './acteur.js';
import {
  signerAssertion,
  verifierAssertion,
  VERSION_ASSERTION,
  type ChargeAssertion,
} from './assertion-identite.js';

const SECRET = 'secret-de-test-piste-audit';
const MAINTENANT = new Date('2026-08-14T10:00:00.000Z');

/**
 * Charge **réellement signée puis vérifiée**, jamais écrite à la main : c'est la
 * seule façon que ce test parle du même objet que la production. Sept tests du
 * dépôt ont affirmé un format en fabriquant leur corps eux-mêmes (`LE-39`), et
 * aucun ne décrivait ce qui circulait vraiment.
 */
function chargeReelle(
  entree: Parameters<typeof signerAssertion>[0],
): ChargeAssertion {
  const charge = verifierAssertion(
    signerAssertion(entree, SECRET, MAINTENANT),
    SECRET,
    MAINTENANT,
  );
  if (charge === null) {
    throw new Error('assertion de test invalide — le montage du test est faux');
  }
  return charge;
}

describe('acteurDepuisAssertion', () => {
  it('rend un acteur parent depuis une assertion parent réellement signée', () => {
    const acteur = acteurDepuisAssertion(
      chargeReelle({ email: 'claire@example.test', foyers: ['f1'] }),
    );
    expect(acteur).toEqual({ type: 'parent', email: 'claire@example.test' });
  });

  it('rend un acteur service depuis une assertion machine', () => {
    const acteur = acteurDepuisAssertion(
      chargeReelle({ machine: 'api-gateway' }),
    );
    expect(acteur).toEqual({ type: 'service', nom: 'api-gateway' });
  });

  it("rend « inconnu » quand aucune assertion n'a été posée sur la requête", () => {
    // Cas réel en mode observe : assertion absente ou invalide ⇒ la requête passe
    // quand même, la mutation a lieu, et sa trace doit le dire.
    expect(acteurDepuisAssertion(undefined)).toEqual(ACTEUR_INCONNU);
  });

  it('rend « inconnu » sur une charge sans email ni machine plutôt que de deviner', () => {
    // `verifierAssertion` rejette déjà ce payload ; la traduction ne s'en remet
    // pas à cette garantie pour autant — elle rapporte, elle ne complète pas.
    const vide = { v: VERSION_ASSERTION, iat: 0, exp: 0 } as ChargeAssertion;
    expect(acteurDepuisAssertion(vide)).toEqual(ACTEUR_INCONNU);
  });
});

describe('libelleActeur', () => {
  it("nomme le parent par son e-mail, le service par son nom, l'inconnu comme tel", () => {
    expect(libelleActeur({ type: 'parent', email: 'a@b.test' })).toBe(
      'a@b.test',
    );
    expect(libelleActeur({ type: 'service', nom: 'api-gateway' })).toBe(
      'service:api-gateway',
    );
    expect(libelleActeur(ACTEUR_INCONNU)).toBe('inconnu');
  });
});
