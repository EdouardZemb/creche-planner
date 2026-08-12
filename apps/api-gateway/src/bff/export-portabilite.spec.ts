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
    },
    planification: { contrats: [], etablissements: [] },
    notifications: {
      validationsHebdo: [],
      envoisRecapFoyer: [],
      envoisRecapParent: [],
      envoisEtablissement: [],
      messagesInApp: [],
    },
    ...overrides,
  };
}

describe('assemblerExport', () => {
  it('range les trois parts sous les sections nommées du document', () => {
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
    ]);
  });

  // Pureté : aucune horloge, aucune I/O. L'instant vient de l'appelant — c'est ce
  // qui empêche un `new Date()` de se loger dans un assemblage partagé (`LE-34`).
  it('est pure : deux appels avec les mêmes entrées rendent le même document', () => {
    expect(assemblerExport(parts())).toEqual(assemblerExport(parts()));
  });
});
