import { describe, expect, it } from 'vitest';
import { instant, type Instant } from '@creche-planner/shared-kernel';
import {
  ancreDeConnaissance,
  clore,
  resoudreJour,
  resoudreMois,
  verifierUniciteOuverte,
  type CalendrierOuverture,
  type ExceptionCalendrier,
  type PeriodeCalendrier,
  type RecurrenceCalendrier,
} from './calendrier-ouverture.js';
import {
  CalendrierIncoherentError,
  ConnaissanceInvalideError,
  DateInvalideError,
} from './planification-error.js';

/**
 * Repères de temps. `SAISIE` est l'instant de la première saisie du calendrier,
 * `RETOUCHE` celui d'une correction faite bien plus tard — et `AVANT`/`APRES`
 * l'encadrent. Les deux axes sont visibles à l'œil nu : ces quatre-là sont des
 * **instants**, les dates des fixtures sont des **jours**.
 */
const SAISIE = instant('2026-01-02T08:00:00.000Z');
const AVANT = instant('2026-09-01T00:00:00.000Z');
const RETOUCHE = instant('2026-09-15T10:00:00.000Z');
const APRES = instant('2026-10-01T00:00:00.000Z');

/** Jours de référence 2026 (Pâques le 5 avril). */
const LUNDI_SCOLAIRE = '2026-03-09';
const MERCREDI_SCOLAIRE = '2026-03-11';
const SAMEDI_SCOLAIRE = '2026-03-14';
const VENDREDI_SAINT = '2026-04-03';
const JEUDI_DE_VACANCES = '2026-04-16';
const FERMETURE_CRECHE = '2026-07-28';

const ecoleSemaine = (
  jourSemaine: RecurrenceCalendrier['jourSemaine'],
  regime: RecurrenceCalendrier['regime'],
  services: RecurrenceCalendrier['services'],
): RecurrenceCalendrier => ({
  regime,
  jourSemaine,
  services,
  connuDepuis: SAISIE,
});

const PERIODES_ECOLE: PeriodeCalendrier[] = [
  {
    type: 'PERIODE_SCOLAIRE',
    libelle: 'Période scolaire',
    du: '2026-01-05',
    au: '2026-04-11',
    connuDepuis: SAISIE,
  },
  {
    type: 'VACANCES',
    libelle: 'Vacances de printemps',
    du: '2026-04-12',
    au: '2026-04-27',
    connuDepuis: SAISIE,
  },
];

const RECURRENCES_ECOLE: RecurrenceCalendrier[] = [
  ecoleSemaine('LUNDI', 'SCOLAIRE', ['CANTINE', 'PERISCOLAIRE']),
  ecoleSemaine('MARDI', 'SCOLAIRE', ['CANTINE', 'PERISCOLAIRE']),
  ecoleSemaine('MERCREDI', 'SCOLAIRE', ['ALSH']),
  ecoleSemaine('JEUDI', 'SCOLAIRE', ['CANTINE', 'PERISCOLAIRE']),
  ecoleSemaine('VENDREDI', 'SCOLAIRE', ['CANTINE', 'PERISCOLAIRE']),
  ecoleSemaine('LUNDI', 'VACANCES', ['ALSH']),
  ecoleSemaine('MARDI', 'VACANCES', ['ALSH']),
  ecoleSemaine('MERCREDI', 'VACANCES', ['ALSH']),
  ecoleSemaine('JEUDI', 'VACANCES', ['ALSH']),
  ecoleSemaine('VENDREDI', 'VACANCES', ['ALSH']),
];

/** L'école de référence : Mulhouse, donc droit local d'Alsace-Moselle. */
const ecole = (
  exceptions: ExceptionCalendrier[] = [],
): CalendrierOuverture => ({
  regimeFeries: 'FR_ALSACE_MOSELLE',
  periodes: PERIODES_ECOLE,
  exceptions,
  recurrences: RECURRENCES_ECOLE,
});

const CRECHE: CalendrierOuverture = {
  regimeFeries: 'FR_ALSACE_MOSELLE',
  periodes: [
    {
      type: 'FERMETURE_ANNUELLE',
      libelle: 'Crèche fermée (été)',
      du: '2026-07-27',
      au: '2026-07-31',
      connuDepuis: SAISIE,
    },
  ],
  exceptions: [],
  recurrences: (
    ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI'] as const
  ).map((jourSemaine) => ecoleSemaine(jourSemaine, 'SCOLAIRE', ['CRECHE_PSU'])),
};

const VIERGE: CalendrierOuverture = {
  regimeFeries: 'FR_ALSACE_MOSELLE',
  periodes: [],
  exceptions: [],
  recurrences: [],
};

describe('resoudreJour — table de vérité (RM-31-01, RM-31-02)', () => {
  it('lundi scolaire : cantine et périscolaire, sous le libellé de la période', () => {
    expect(resoudreJour(ecole(), LUNDI_SCOLAIRE, APRES)).toEqual({
      jour: LUNDI_SCOLAIRE,
      contexte: 'PERIODE_SCOLAIRE',
      libelle: 'Période scolaire',
      servicesOuverts: ['CANTINE', 'PERISCOLAIRE'],
    });
  });

  it('mercredi scolaire : ALSH seul', () => {
    expect(resoudreJour(ecole(), MERCREDI_SCOLAIRE, APRES)).toMatchObject({
      contexte: 'PERIODE_SCOLAIRE',
      servicesOuverts: ['ALSH'],
    });
  });

  it('jeudi de vacances : ALSH seul, contexte « vacances »', () => {
    expect(resoudreJour(ecole(), JEUDI_DE_VACANCES, APRES)).toEqual({
      jour: JEUDI_DE_VACANCES,
      contexte: 'VACANCES',
      libelle: 'Vacances de printemps',
      servicesOuverts: ['ALSH'],
    });
  });

  it('samedi : la récurrence est muette, donc rien n’est ouvert', () => {
    expect(resoudreJour(ecole(), SAMEDI_SCOLAIRE, APRES)).toMatchObject({
      contexte: 'PERIODE_SCOLAIRE',
      servicesOuverts: [],
    });
  });

  it('Vendredi saint en Alsace-Moselle : tout est fermé', () => {
    expect(resoudreJour(ecole(), VENDREDI_SAINT, APRES)).toEqual({
      jour: VENDREDI_SAINT,
      contexte: 'FERIE',
      libelle: 'Vendredi saint',
      servicesOuverts: [],
    });
  });

  it('Vendredi saint en régime national : jour d’école ordinaire', () => {
    const national: CalendrierOuverture = { ...ecole(), regimeFeries: 'FR' };
    expect(resoudreJour(national, VENDREDI_SAINT, APRES)).toMatchObject({
      contexte: 'PERIODE_SCOLAIRE',
      servicesOuverts: ['CANTINE', 'PERISCOLAIRE'],
    });
  });

  it('exception d’OUVERTURE sur un férié : le jour rouvre selon sa récurrence', () => {
    const calendrier = ecole([
      {
        jour: VENDREDI_SAINT,
        type: 'OUVERTURE',
        libelle: 'Ouverture exceptionnelle',
        connuDepuis: SAISIE,
      },
    ]);
    expect(resoudreJour(calendrier, VENDREDI_SAINT, APRES)).toEqual({
      jour: VENDREDI_SAINT,
      contexte: 'PERIODE_SCOLAIRE',
      libelle: 'Ouverture exceptionnelle',
      servicesOuverts: ['CANTINE', 'PERISCOLAIRE'],
    });
  });

  it('exception d’OUVERTURE nommant ses services : ceux-là seulement', () => {
    const calendrier = ecole([
      {
        jour: VENDREDI_SAINT,
        type: 'OUVERTURE',
        libelle: 'Garderie de dépannage',
        services: ['PERISCOLAIRE'],
        connuDepuis: SAISIE,
      },
    ]);
    expect(
      resoudreJour(calendrier, VENDREDI_SAINT, APRES).servicesOuverts,
    ).toEqual(['PERISCOLAIRE']);
  });

  it('journée pédagogique : le jour ferme entièrement, sous son libellé', () => {
    const calendrier = ecole([
      {
        jour: LUNDI_SCOLAIRE,
        type: 'JOURNEE_PEDAGOGIQUE',
        libelle: 'Journée pédagogique',
        connuDepuis: SAISIE,
      },
    ]);
    expect(resoudreJour(calendrier, LUNDI_SCOLAIRE, APRES)).toEqual({
      jour: LUNDI_SCOLAIRE,
      contexte: 'FERMETURE',
      libelle: 'Journée pédagogique',
      servicesOuverts: [],
    });
  });

  it('fermeture partielle : le jour reste scolaire, amputé du service fermé', () => {
    const calendrier = ecole([
      {
        jour: LUNDI_SCOLAIRE,
        type: 'FERMETURE',
        libelle: 'Cantine fermée',
        services: ['CANTINE'],
        connuDepuis: SAISIE,
      },
    ]);
    expect(resoudreJour(calendrier, LUNDI_SCOLAIRE, APRES)).toEqual({
      jour: LUNDI_SCOLAIRE,
      contexte: 'PERIODE_SCOLAIRE',
      libelle: 'Cantine fermée',
      servicesOuverts: ['PERISCOLAIRE'],
    });
  });

  it('fermeture annuelle de la crèche : fermé, avec son libellé', () => {
    expect(resoudreJour(CRECHE, FERMETURE_CRECHE, APRES)).toEqual({
      jour: FERMETURE_CRECHE,
      contexte: 'FERMETURE',
      libelle: 'Crèche fermée (été)',
      servicesOuverts: [],
    });
  });

  it('hors fermeture, la crèche ouvre selon son régime unique', () => {
    expect(resoudreJour(CRECHE, LUNDI_SCOLAIRE, APRES)).toMatchObject({
      contexte: 'PERIODE_SCOLAIRE',
      libelle: '',
      servicesOuverts: ['CRECHE_PSU'],
    });
  });

  it('refuse une date qui n’est pas un jour ISO', () => {
    expect(() => resoudreJour(ecole(), '09/03/2026', APRES)).toThrow(
      DateInvalideError,
    );
  });
});

describe('établissement vierge (D7)', () => {
  it('ouvre tous les services tous les jours…', () => {
    expect(resoudreJour(VIERGE, SAMEDI_SCOLAIRE, APRES)).toEqual({
      jour: SAMEDI_SCOLAIRE,
      contexte: 'PERIODE_SCOLAIRE',
      libelle: '',
      servicesOuverts: ['CRECHE_PSU', 'PERISCOLAIRE', 'CANTINE', 'ALSH'],
    });
  });

  it('… sauf les fériés de son régime', () => {
    expect(resoudreJour(VIERGE, VENDREDI_SAINT, APRES)).toMatchObject({
      contexte: 'FERIE',
      servicesOuverts: [],
    });
    expect(
      resoudreJour({ ...VIERGE, regimeFeries: 'FR' }, VENDREDI_SAINT, APRES)
        .servicesOuverts,
    ).toHaveLength(4);
  });
});

describe('resoudreMois', () => {
  it('rend chaque jour du mois, au même instant de connaissance', () => {
    const avril = resoudreMois(ecole(), '2026-04', APRES);
    expect(avril).toHaveLength(30);
    expect(avril[0]?.jour).toBe('2026-04-01');
    expect(avril[29]?.jour).toBe('2026-04-30');
    expect(avril.find((j) => j.jour === VENDREDI_SAINT)?.libelle).toBe(
      'Vendredi saint',
    );
    expect(avril.find((j) => j.jour === JEUDI_DE_VACANCES)?.contexte).toBe(
      'VACANCES',
    );
  });

  it('est jour à jour identique à resoudreJour', () => {
    const mois = resoudreMois(CRECHE, '2026-07', APRES);
    for (const jour of mois) {
      expect(jour).toEqual(resoudreJour(CRECHE, jour.jour, APRES));
    }
  });
});

/**
 * **Le critère qui prouve l'amendement PO** (RM-31-03, décision du 2026-08-16).
 * Sans ces trois tests, le lot ne vaut rien : tout le reste passerait aussi avec
 * une résolution qui ignore l'instant de connaissance.
 */
describe('versionnement : ce que le calendrier disait, quand il le disait', () => {
  /**
   * Le 15 septembre, le parent déclare après coup une journée pédagogique sur un
   * jeudi d'avril — un jour **déjà facturé**. Modèle append-only : rien n'est
   * écrasé, la ligne existante est close et une nouvelle est ouverte.
   */
  const retouchePassee = ecole([
    {
      jour: JEUDI_DE_VACANCES,
      type: 'JOURNEE_PEDAGOGIQUE',
      libelle: 'Journée pédagogique (déclarée en septembre)',
      connuDepuis: RETOUCHE,
    },
  ]);

  it('deux instants encadrant la retouche donnent deux réponses', () => {
    expect(
      resoudreJour(retouchePassee, JEUDI_DE_VACANCES, AVANT),
    ).toMatchObject({ contexte: 'VACANCES', servicesOuverts: ['ALSH'] });
    expect(
      resoudreJour(retouchePassee, JEUDI_DE_VACANCES, APRES),
    ).toMatchObject({ contexte: 'FERMETURE', servicesOuverts: [] });
  });

  it('deux instants n’encadrant aucune retouche donnent la même réponse', () => {
    expect(resoudreJour(retouchePassee, JEUDI_DE_VACANCES, SAISIE)).toEqual(
      resoudreJour(retouchePassee, JEUDI_DE_VACANCES, AVANT),
    );
  });

  it('le mois facturé garde son interprétation, la retouche ne le rattrape pas', () => {
    const factureLe = instant('2026-05-02T06:00:00.000Z');
    const maintenant = APRES;
    const avril = resoudreMois(
      retouchePassee,
      '2026-04',
      ancreDeConnaissance(maintenant, factureLe),
    );
    expect(
      avril.find((j) => j.jour === JEUDI_DE_VACANCES)?.servicesOuverts,
    ).toEqual(['ALSH']);
    // …et le mois non encore facturé, lui, suit le calendrier d'aujourd'hui.
    const avrilNonFacture = resoudreMois(
      retouchePassee,
      '2026-04',
      ancreDeConnaissance(maintenant),
    );
    expect(
      avrilNonFacture.find((j) => j.jour === JEUDI_DE_VACANCES)
        ?.servicesOuverts,
    ).toEqual([]);
  });

  it('une récurrence retouchée : la ligne close reste lisible pour le passé', () => {
    const calendrier: CalendrierOuverture = {
      ...ecole(),
      recurrences: [
        ...RECURRENCES_ECOLE.filter(
          (r) => !(r.regime === 'SCOLAIRE' && r.jourSemaine === 'MERCREDI'),
        ),
        clore(ecoleSemaine('MERCREDI', 'SCOLAIRE', ['ALSH']), RETOUCHE),
        {
          regime: 'SCOLAIRE',
          jourSemaine: 'MERCREDI',
          services: ['ALSH', 'CANTINE'],
          connuDepuis: RETOUCHE,
        },
      ],
    };
    expect(
      resoudreJour(calendrier, MERCREDI_SCOLAIRE, AVANT).servicesOuverts,
    ).toEqual(['ALSH']);
    expect(
      resoudreJour(calendrier, MERCREDI_SCOLAIRE, APRES).servicesOuverts,
    ).toEqual(['ALSH', 'CANTINE']);
  });

  it('une ligne pas encore connue est ignorée, une ligne close aussi', () => {
    const jamaisConnue = ecole([
      {
        jour: LUNDI_SCOLAIRE,
        type: 'FERMETURE',
        libelle: 'Fermeture future',
        connuDepuis: APRES,
      },
    ]);
    expect(
      resoudreJour(jamaisConnue, LUNDI_SCOLAIRE, AVANT).servicesOuverts,
    ).toHaveLength(2);
    const close = ecole([
      clore<ExceptionCalendrier>(
        {
          jour: LUNDI_SCOLAIRE,
          type: 'FERMETURE',
          libelle: 'Fermeture annulée',
          connuDepuis: SAISIE,
        },
        RETOUCHE,
      ),
    ]);
    expect(
      resoudreJour(close, LUNDI_SCOLAIRE, APRES).servicesOuverts,
    ).toHaveLength(2);
    expect(resoudreJour(close, LUNDI_SCOLAIRE, AVANT).servicesOuverts).toEqual(
      [],
    );
  });

  it('l’instant de clôture appartient déjà à la ligne suivante (borne exclusive)', () => {
    const calendrier = ecole([
      clore<ExceptionCalendrier>(
        {
          jour: LUNDI_SCOLAIRE,
          type: 'FERMETURE',
          libelle: 'Fermeture annulée',
          connuDepuis: SAISIE,
        },
        RETOUCHE,
      ),
    ]);
    expect(
      resoudreJour(calendrier, LUNDI_SCOLAIRE, RETOUCHE).servicesOuverts,
    ).toHaveLength(2);
  });

  it('deux lignes ouvertes sur la même clé : la plus récemment connue tranche, quel que soit l’ordre', () => {
    const ancienne: ExceptionCalendrier = {
      jour: LUNDI_SCOLAIRE,
      type: 'FERMETURE',
      libelle: 'Ancienne',
      connuDepuis: SAISIE,
    };
    const recente: ExceptionCalendrier = {
      jour: LUNDI_SCOLAIRE,
      type: 'OUVERTURE',
      libelle: 'Récente',
      connuDepuis: RETOUCHE,
    };
    expect(
      resoudreJour(ecole([ancienne, recente]), LUNDI_SCOLAIRE, APRES).libelle,
    ).toBe('Récente');
    expect(
      resoudreJour(ecole([recente, ancienne]), LUNDI_SCOLAIRE, APRES).libelle,
    ).toBe('Récente');
  });
});

/**
 * **Sonde négative** (exigée par le plan, lot 1). Une génération qui résout sans
 * `aLaDate` — ou en le figeant à « maintenant » — compile, passe la table de vérité
 * ci-dessus, et annule tout l'amendement PO **en silence**. Ces deux tests
 * matérialisent ce défaut-là et vérifient que la fixture le voit.
 */
describe('sonde négative : une résolution qui ignore l’axe de connaissance', () => {
  const calendrier = ecole([
    {
      jour: JEUDI_DE_VACANCES,
      type: 'JOURNEE_PEDAGOGIQUE',
      libelle: 'Journée pédagogique (déclarée en septembre)',
      connuDepuis: RETOUCHE,
    },
  ]);
  const ancreDeFacturation = instant('2026-05-02T06:00:00.000Z');

  it('figer l’instant à « maintenant » change la réponse d’un mois facturé', () => {
    const juste = resoudreJour(
      calendrier,
      JEUDI_DE_VACANCES,
      ancreDeFacturation,
    );
    const defaut = resoudreJour(calendrier, JEUDI_DE_VACANCES, APRES);
    expect(defaut).not.toEqual(juste);
    expect(juste.servicesOuverts).toEqual(['ALSH']);
    expect(defaut.servicesOuverts).toEqual([]);
  });

  it('ne garder que les lignes ouvertes revient au même défaut', () => {
    /** Le raccourci tentant : « les lignes courantes, c'est celles qui sont ouvertes ». */
    const naif = (cal: CalendrierOuverture, jour: string, _aLaDate: Instant) =>
      resoudreJour(
        {
          ...cal,
          periodes: cal.periodes.filter((l) => l.connuJusqua === undefined),
          exceptions: cal.exceptions.filter((l) => l.connuJusqua === undefined),
          recurrences: cal.recurrences.filter(
            (l) => l.connuJusqua === undefined,
          ),
        },
        jour,
        APRES,
      );
    expect(naif(calendrier, JEUDI_DE_VACANCES, ancreDeFacturation)).not.toEqual(
      resoudreJour(calendrier, JEUDI_DE_VACANCES, ancreDeFacturation),
    );
  });
});

describe('ancreDeConnaissance', () => {
  it('un mois facturé garde l’instant de sa facturation', () => {
    const factureLe = instant('2026-05-02T06:00:00.000Z');
    expect(ancreDeConnaissance(APRES, factureLe)).toBe(factureLe);
  });

  it('un mois non facturé suit le calendrier d’aujourd’hui', () => {
    expect(ancreDeConnaissance(APRES)).toBe(APRES);
  });
});

describe('clore', () => {
  const ligne = { connuDepuis: SAISIE };

  it('date la fin de connaissance sans rien effacer', () => {
    expect(clore(ligne, RETOUCHE)).toEqual({
      connuDepuis: SAISIE,
      connuJusqua: RETOUCHE,
    });
    expect(ligne).toEqual({ connuDepuis: SAISIE });
  });

  it('refuse de clore deux fois', () => {
    expect(() => clore(clore(ligne, RETOUCHE), APRES)).toThrow(
      ConnaissanceInvalideError,
    );
  });

  it('refuse une clôture antérieure à l’ouverture', () => {
    expect(() => clore({ connuDepuis: RETOUCHE }, SAISIE)).toThrow(
      ConnaissanceInvalideError,
    );
  });
});

describe('verifierUniciteOuverte — l’unicité est PARTIELLE (D2 révisée)', () => {
  it('accepte un historique : autant de lignes closes que de retouches', () => {
    expect(() => {
      verifierUniciteOuverte(
        ecole([
          clore(
            {
              jour: LUNDI_SCOLAIRE,
              type: 'FERMETURE',
              libelle: 'v1',
              connuDepuis: SAISIE,
            },
            RETOUCHE,
          ),
          {
            jour: LUNDI_SCOLAIRE,
            type: 'PONT',
            libelle: 'v2',
            connuDepuis: RETOUCHE,
          },
        ]),
      );
    }).not.toThrow();
  });

  it('refuse deux exceptions ouvertes le même jour', () => {
    expect(() => {
      verifierUniciteOuverte(
        ecole([
          {
            jour: LUNDI_SCOLAIRE,
            type: 'FERMETURE',
            libelle: 'v1',
            connuDepuis: SAISIE,
          },
          {
            jour: LUNDI_SCOLAIRE,
            type: 'PONT',
            libelle: 'v2',
            connuDepuis: RETOUCHE,
          },
        ]),
      );
    }).toThrow(CalendrierIncoherentError);
  });

  it('refuse deux récurrences ouvertes sur le même régime × jour', () => {
    expect(() => {
      verifierUniciteOuverte({
        ...ecole(),
        recurrences: [
          ...RECURRENCES_ECOLE,
          ecoleSemaine('MERCREDI', 'SCOLAIRE', ['CANTINE']),
        ],
      });
    }).toThrow(CalendrierIncoherentError);
  });

  it('tolère une récurrence close doublant une récurrence ouverte', () => {
    expect(() => {
      verifierUniciteOuverte({
        ...ecole(),
        recurrences: [
          ...RECURRENCES_ECOLE,
          clore(ecoleSemaine('MERCREDI', 'SCOLAIRE', ['CANTINE']), RETOUCHE),
        ],
      });
    }).not.toThrow();
  });

  it('laisse plusieurs périodes couvrir un même jour', () => {
    expect(() => {
      verifierUniciteOuverte({
        ...CRECHE,
        periodes: [
          ...CRECHE.periodes,
          {
            type: 'VACANCES',
            libelle: 'Vacances d’été',
            du: '2026-07-04',
            au: '2026-08-31',
            connuDepuis: SAISIE,
          },
        ],
      });
    }).not.toThrow();
  });
});
