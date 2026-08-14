import { describe, expect, it } from 'vitest';
import {
  ACTEUR_INCONNU,
  acteurDepuisAssertion,
  identiteActeur,
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

  /**
   * Un administrateur **contourne** l'appartenance au foyer (`AppartenanceGuard`,
   * bypass `ADMIN_EMAILS`) : le confondre avec un parent ferait apparaître, dans
   * l'export d'un foyer, un « parent » dont l'adresse n'appartient à personne du
   * foyer. C'est la confusion qu'une piste d'audit existe pour empêcher.
   */
  it("distingue l'administrateur du parent, l'e-mail étant le même champ", () => {
    const acteur = acteurDepuisAssertion(
      chargeReelle({ email: 'po@example.test', admin: true }),
    );
    expect(acteur).toEqual({ type: 'admin', email: 'po@example.test' });
    expect(identiteActeur(acteur)).toBe('po@example.test');
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
    expect(libelleActeur({ type: 'admin', email: 'po@b.test' })).toBe(
      'admin:po@b.test',
    );
    expect(libelleActeur({ type: 'service', nom: 'api-gateway' })).toBe(
      'service:api-gateway',
    );
    expect(libelleActeur(ACTEUR_INCONNU)).toBe('inconnu');
  });
});

describe('identiteActeur', () => {
  /**
   * Ce que la **colonne** porte, et qui n'est pas le libellé : la nature vit déjà
   * dans `acteur_type`, la répéter dans la valeur rendrait toute recherche par
   * e-mail dépendante d'un préfixe.
   */
  it('rend l’identité nue, sans la nature, et null quand il n’y en a pas', () => {
    expect(identiteActeur({ type: 'parent', email: 'a@b.test' })).toBe(
      'a@b.test',
    );
    expect(identiteActeur({ type: 'admin', email: 'po@b.test' })).toBe(
      'po@b.test',
    );
    expect(identiteActeur({ type: 'service', nom: 'api-gateway' })).toBe(
      'api-gateway',
    );
    expect(identiteActeur(ACTEUR_INCONNU)).toBeNull();
  });
});
