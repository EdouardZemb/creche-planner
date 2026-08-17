import { describe, expect, it } from 'vitest';
import {
  DEFAUTS_PREFERENCES,
  materialiserConsentementParDefaut,
  payloadPreferences,
  preferencesEffectives,
  typeServiceInjoignable,
} from './preferences.util.js';
import type { PreferenceNotificationRow } from '../database/schema.js';

/**
 * Cœur **pur** du consentement aux notifications (`AM-57`, lot 2 « le coût ne ment
 * plus »). Ces fonctions décident, à elles seules, si un courriel part vers un parent
 * réel : leur règle de lecture est donc testée pour ce qu'elle fait d'une **absence**.
 *
 * Le défaut corrigé : le consentement se déduisait d'une absence de ligne, si bien que
 * **supprimer** la ligne d'un parent désabonné le réabonnait — sans trace, et
 * précisément sur la population qu'une borne de rétention (T3bis, doc 37) visait.
 */

const PARENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSCRIPTION = new Date('2026-01-15T08:00:00.000Z');
const DESABONNEMENT = new Date('2026-08-01T10:00:00.000Z');

function ligne(
  overrides: Partial<PreferenceNotificationRow> = {},
): PreferenceNotificationRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    parentId: PARENT,
    typeNotification: 'VALIDATION_HEBDO',
    canal: 'EMAIL',
    actif: true,
    consentementAt: INSCRIPTION,
    desabonneAt: null,
    sourceDernier: 'DEFAUT',
    createdAt: INSCRIPTION,
    updatedAt: INSCRIPTION,
    ...overrides,
  };
}

/** La ligne telle que la pose le lien one-click RFC 8058 (`DesabonnementService`). */
const DESABONNE = ligne({
  actif: false,
  consentementAt: null,
  desabonneAt: DESABONNEMENT,
  sourceDernier: 'LIEN_DESABO',
});

describe('preferencesEffectives', () => {
  it('SONDE NÉGATIVE — la suppression de la ligne « désabonné » ne réabonne plus le parent', () => {
    const avec = preferencesEffectives([DESABONNE]).find(
      (p) => p.canal === 'EMAIL',
    );
    expect(avec?.actif).toBe(false);
    expect(avec?.desabonneAt).toBe(DESABONNEMENT.toISOString());

    // Purge de rétention, effacement, geste manuel : la ligne disparaît. Avant ce
    // lot, la lecture retombait sur le défaut applicatif et rendait `actif: true`.
    const sans = preferencesEffectives([]).find((p) => p.canal === 'EMAIL');
    expect(sans?.actif).toBe(false);
  });

  it('l’événement d’état diffusé n’annonce pas non plus un réabonnement', () => {
    // Le payload est projeté tel quel par `svc-notifications` : s'il portait
    // `actif: true`, le read model réabonnerait le parent en aval, hors de portée
    // de toute correction locale.
    const payload = payloadPreferences(
      FOYER,
      PARENT,
      preferencesEffectives([]),
    );
    expect(payload.preferences).toEqual([
      { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: false },
      { typeNotification: 'VALIDATION_HEBDO', canal: 'IN_APP', actif: false },
    ]);
  });

  it('rend la matrice complète, chaque combinaison renseignée par sa ligne', () => {
    const vues = preferencesEffectives([
      ligne({ canal: 'EMAIL', actif: true }),
      ligne({ id: 'p-2', canal: 'IN_APP', actif: false }),
    ]);
    expect(vues).toHaveLength(DEFAUTS_PREFERENCES.length);
    expect(vues.map((v) => [v.canal, v.actif])).toEqual([
      ['EMAIL', true],
      ['IN_APP', false],
    ]);
    expect(vues[0]?.consentementAt).toBe(INSCRIPTION.toISOString());
  });

  it('une ligne hors matrice (type futur) est rendue telle quelle', () => {
    const vues = preferencesEffectives([
      ligne({ id: 'p-3', typeNotification: 'RECAP_SERVICE', canal: 'EMAIL' }),
    ]);
    expect(vues.map((v) => v.typeNotification)).toContain('RECAP_SERVICE');
  });

  it('un parent sans aucune ligne est injoignable pour un type de service', () => {
    // Conséquence assumée et **fermée** : sans consentement enregistré, aucun canal
    // n'est actif. L'état n'existe pas en production (la matrice est matérialisée à
    // l'inscription, et le back-fill 0008 l'a posée pour les parents antérieurs) ;
    // s'il survenait, il refuse d'envoyer plutôt que d'inventer un accord.
    expect(typeServiceInjoignable(preferencesEffectives([]))).toBe(
      'VALIDATION_HEBDO',
    );
  });
});

describe('materialiserConsentementParDefaut', () => {
  it('écrit une ligne par combinaison, tracée DEFAUT et horodatée', () => {
    const lignes = materialiserConsentementParDefaut(PARENT, INSCRIPTION);

    expect(lignes).toHaveLength(DEFAUTS_PREFERENCES.length);
    for (const l of lignes) {
      expect(l.parentId).toBe(PARENT);
      expect(l.actif).toBe(true);
      // `DEFAUT` distingue pour toujours un consentement HÉRITÉ du défaut applicatif
      // d'un geste de l'utilisateur (`ECRAN`, `LIEN_DESABO`).
      expect(l.sourceDernier).toBe('DEFAUT');
      expect(l.consentementAt).toBe(INSCRIPTION);
      expect(l.desabonneAt).toBeNull();
    }
  });

  it('produit exactement la matrice exposée au parent (aucune divergence possible)', () => {
    expect(
      materialiserConsentementParDefaut(PARENT, INSCRIPTION).map((l) => [
        l.typeNotification,
        l.canal,
        l.actif,
      ]),
    ).toEqual(
      DEFAUTS_PREFERENCES.map((d) => [d.typeNotification, d.canal, d.actif]),
    );
  });
});
