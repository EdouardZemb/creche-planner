import { describe, expect, it } from 'vitest';
import {
  VERSION_FORMAT_EXPORT,
  assemblerExport,
  type PartsExport,
} from './export-portabilite.js';

const FOYER_ID = 'abcd1234-0000-4000-8000-000000000000';

function parts(overrides: Partial<PartsExport> = {}): PartsExport {
  return {
    foyerId: FOYER_ID,
    genereLe: '2026-08-12T06:30:00.000Z',
    foyer: {
      situationCourante: { id: FOYER_ID },
      versionsRessources: [],
      correctionsRessources: [],
      enfants: [],
      parents: [{ email: 'alex@example.test' }],
      preferencesNotification: [],
      jetonsDesabonnement: [],
      pisteAudit: [],
    },
    planification: { contrats: [], etablissements: [] },
    notifications: {
      validationsHebdo: [],
      envoisRecapFoyer: [],
      envoisRecapParent: [],
      envoisEtablissement: [],
      messagesInApp: [],
    },
    unitesAssociatives: { foyerId: FOYER_ID, engagements: [], pisteAudit: [] },
    ...overrides,
  };
}

describe('assemblerExport', () => {
  it('range les quatre parts sous les sections nommées du document', () => {
    const vue = assemblerExport(parts());

    expect(vue.versionFormat).toBe(VERSION_FORMAT_EXPORT);
    expect(vue.genereLe).toBe('2026-08-12T06:30:00.000Z');
    expect(vue.foyerId).toBe(FOYER_ID);
    expect(vue.situationFoyer.parents).toEqual([
      { email: 'alex@example.test' },
    ]);
    expect(Object.keys(vue)).toEqual([
      'versionFormat',
      'genereLe',
      'foyerId',
      'situationFoyer',
      'gardeEtPlanning',
      'communications',
      'engagementAssociatif',
    ]);
  });

  // SFD 40 : la section ajoutée est ADDITIVE — un lecteur du fichier trouve une
  // section de plus, aucune n'est renommée ni retirée, donc le format ne change
  // pas de version (cf. l'en-tête de `VERSION_FORMAT_EXPORT`).
  it('ajoute l’engagement associatif sans faire bouger la version du format', () => {
    const vue = assemblerExport(
      parts({
        unitesAssociatives: {
          foyerId: FOYER_ID,
          engagements: [
            {
              debut: '2026-06-01',
              fin: '2027-05-31',
              quotaHeures: 20,
              valeurUaCentimes: 3125,
              cautionCentimes: 62500,
              declareLe: '2026-06-02T08:00:00.000Z',
              sessions: [],
            },
          ],
          pisteAudit: [],
        },
      }),
    );
    expect(vue.versionFormat).toBe(VERSION_FORMAT_EXPORT);
    expect(vue.engagementAssociatif.engagements[0]?.quotaHeures).toBe(20);
  });

  // Pureté : aucune horloge, aucune I/O. L'instant vient de l'appelant — c'est ce
  // qui empêche un `new Date()` de se loger dans un assemblage partagé (`LE-34`).
  it('est pure : deux appels avec les mêmes entrées rendent le même document', () => {
    expect(assemblerExport(parts())).toEqual(assemblerExport(parts()));
  });
});
