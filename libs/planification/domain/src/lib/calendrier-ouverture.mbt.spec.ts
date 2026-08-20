/**
 * MBT — calendrier d'ouverture versionné (SFD 31, lot 1).
 * Invariants vérifiés par propriété (fast-check) :
 *  - INV-K1 (le futur ne rétroagit pas) : ajouter une ligne connue APRÈS l'instant
 *    interrogé ne change rien à la résolution à cet instant. C'est l'amendement PO
 *    du 2026-08-16 réduit à sa forme la plus nue.
 *  - INV-K2 (clore n'efface pas) : clore une ligne à `t` laisse identique toute
 *    résolution antérieure à `t`.
 *  - INV-K3 (priorité des couches) : la fermeture totale la plus récemment connue
 *    ferme le jour, quelles que soient les couches inférieures.
 *  - INV-K4 (férié + établissement vierge) : sans exception ce jour-là, un férié du
 *    régime ferme tout ; ailleurs, un établissement vierge est ouvert (D7).
 *  - INV-K5 (mois ≡ jours) : `resoudreMois` est exactement `resoudreJour` appliqué
 *    à chaque jour, au même instant.
 * SUT : calendrier-ouverture.ts.
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  instant,
  joursFeries,
  type Instant,
} from '@creche-planner/shared-kernel';
import {
  SERVICES_CALENDRIER,
  clore,
  resoudreJour,
  resoudreMois,
  type CalendrierOuverture,
  type ExceptionCalendrier,
  type PeriodeCalendrier,
  type RecurrenceCalendrier,
} from './calendrier-ouverture.js';
import { joursDuMois } from './mois.js';

const JOURS_SEMAINE = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

/** Instants ordonnés : l'indice est l'ordre chronologique. */
const ORIGINE = instant('2026-01-01T00:00:00.000Z');
const INSTANTS: readonly Instant[] = [
  ORIGINE,
  instant('2026-04-01T00:00:00.000Z'),
  instant('2026-07-01T00:00:00.000Z'),
  instant('2026-10-01T00:00:00.000Z'),
  instant('2027-01-01T00:00:00.000Z'),
];
const DERNIER = INSTANTS.length - 1;
/** Strictement postérieur à tout ce que les générateurs produisent. */
const POSTERIEUR = instant('2027-06-01T00:00:00.000Z');

/** Instant d'indice `i`, sans indexation non gardée (`noUncheckedIndexedAccess`). */
const instantDe = (indice: number): Instant => INSTANTS[indice] ?? ORIGINE;

const indiceGen = fc.integer({ min: 0, max: DERNIER });

/** Jour de 2026, borné au 28 pour rester valide quel que soit le mois. */
const jourGen = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(
    ([m, j]) =>
      `2026-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`,
  );

const servicesGen = fc.uniqueArray(fc.constantFrom(...SERVICES_CALENDRIER), {
  maxLength: 4,
});

const exceptionGen = fc
  .tuple(
    jourGen,
    fc.constantFrom('FERMETURE', 'OUVERTURE', 'JOURNEE_PEDAGOGIQUE', 'PONT'),
    indiceGen,
    fc.option(servicesGen, { nil: undefined }),
  )
  .map(([jour, type, indice, services]): ExceptionCalendrier => {
    // `exactOptionalPropertyTypes` : « pas de services » s'écrit par l'absence de
    // la clé, jamais par un `undefined` explicite — les deux formes sont générées.
    const base = { jour, type, libelle: `${type} ${jour}` };
    const connuDepuis = instantDe(indice);
    return services === undefined
      ? { ...base, connuDepuis }
      : { ...base, services, connuDepuis };
  });

const periodeGen = fc
  .tuple(
    jourGen,
    fc.constantFrom('PERIODE_SCOLAIRE', 'VACANCES', 'FERMETURE_ANNUELLE'),
    fc.integer({ min: 0, max: 20 }),
    indiceGen,
  )
  .map(([du, type, duree, indice]): PeriodeCalendrier => {
    const finDeMois = Math.min(28, Number(du.slice(8)) + duree);
    return {
      type,
      libelle: `${type} ${du}`,
      du,
      au: `${du.slice(0, 8)}${String(finDeMois).padStart(2, '0')}`,
      connuDepuis: instantDe(indice),
    };
  });

const recurrenceGen = fc
  .tuple(
    fc.constantFrom('SCOLAIRE', 'VACANCES'),
    fc.constantFrom(...JOURS_SEMAINE),
    servicesGen,
    indiceGen,
  )
  .map(([regime, jourSemaine, services, indice]): RecurrenceCalendrier => ({
    regime,
    jourSemaine,
    services,
    connuDepuis: instantDe(indice),
  }));

const calendrierGen = fc
  .tuple(
    fc.constantFrom('FR', 'FR_ALSACE_MOSELLE'),
    fc.array(periodeGen, { maxLength: 4 }),
    fc.array(exceptionGen, { maxLength: 4 }),
    fc.array(recurrenceGen, { maxLength: 6 }),
  )
  .map(
    ([
      regimeFeries,
      periodes,
      exceptions,
      recurrences,
    ]): CalendrierOuverture => ({
      regimeFeries,
      periodes,
      exceptions,
      recurrences,
    }),
  );

describe('MBT calendrier d’ouverture', () => {
  it('INV-K1 le futur ne rétroagit pas : une ligne connue après t ne change rien à t', () => {
    fc.assert(
      fc.property(
        calendrierGen,
        jourGen,
        fc.integer({ min: 0, max: DERNIER - 1 }),
        exceptionGen,
        (calendrier, jour, indice, exception) => {
          const aLaDate = instantDe(indice);
          const avant = resoudreJour(calendrier, jour, aLaDate);
          const posterieure: ExceptionCalendrier = {
            ...exception,
            connuDepuis: instantDe(DERNIER),
          };
          const apres = resoudreJour(
            {
              ...calendrier,
              exceptions: [...calendrier.exceptions, posterieure],
            },
            jour,
            aLaDate,
          );
          return JSON.stringify(apres) === JSON.stringify(avant);
        },
      ),
    );
  });

  it('INV-K2 clore n’efface pas : toute résolution antérieure est inchangée', () => {
    fc.assert(
      fc.property(
        calendrierGen,
        jourGen,
        fc.integer({ min: 0, max: DERNIER - 1 }),
        (calendrier, jour, indice) => {
          const cloture = instantDe(DERNIER);
          const aLaDate = instantDe(indice);
          const avant = resoudreJour(calendrier, jour, aLaDate);
          const apres = resoudreJour(
            {
              ...calendrier,
              periodes: calendrier.periodes.map((l) => clore(l, cloture)),
              exceptions: calendrier.exceptions.map((l) => clore(l, cloture)),
              recurrences: calendrier.recurrences.map((l) => clore(l, cloture)),
            },
            jour,
            aLaDate,
          );
          return JSON.stringify(apres) === JSON.stringify(avant);
        },
      ),
    );
  });

  it('INV-K3 priorité : la fermeture totale la plus récemment connue ferme le jour', () => {
    // `connuDepuis` strictement postérieur : à instant égal, c'est l'ordre du
    // tableau qui trancherait — cas qu'`verifierUniciteOuverte` interdit en base,
    // et que la propriété n'a donc pas à explorer.
    fc.assert(
      fc.property(calendrierGen, jourGen, (calendrier, jour) => {
        const fermeture: ExceptionCalendrier = {
          jour,
          type: 'FERMETURE',
          libelle: 'Fermeture totale',
          connuDepuis: POSTERIEUR,
        };
        const resolu = resoudreJour(
          {
            ...calendrier,
            exceptions: [...calendrier.exceptions, fermeture],
          },
          jour,
          POSTERIEUR,
        );
        return (
          resolu.contexte === 'FERMETURE' && resolu.servicesOuverts.length === 0
        );
      }),
    );
  });

  it('INV-K4 un établissement vierge est fermé ses fériés, ouvert partout ailleurs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('FR' as const, 'FR_ALSACE_MOSELLE' as const),
        jourGen,
        indiceGen,
        (regimeFeries, jour, indice) => {
          const feries = joursFeries(2026, regimeFeries).map((f) => f.jour);
          const resolu = resoudreJour(
            { regimeFeries, periodes: [], exceptions: [], recurrences: [] },
            jour,
            instantDe(indice),
          );
          if (feries.includes(jour)) {
            return (
              resolu.contexte === 'FERIE' && resolu.servicesOuverts.length === 0
            );
          }
          return (
            resolu.servicesOuverts.length === SERVICES_CALENDRIER.length &&
            SERVICES_CALENDRIER.every((service) =>
              resolu.servicesOuverts.includes(service),
            )
          );
        },
      ),
    );
  });

  it('INV-K5 resoudreMois est resoudreJour jour par jour', () => {
    fc.assert(
      fc.property(
        calendrierGen,
        fc.integer({ min: 1, max: 12 }),
        indiceGen,
        (calendrier, numeroMois, indice) => {
          const mois = `2026-${String(numeroMois).padStart(2, '0')}`;
          const aLaDate = instantDe(indice);
          const parMois = resoudreMois(calendrier, mois, aLaDate);
          const parJour = joursDuMois(mois).map((jour) =>
            resoudreJour(calendrier, jour, aLaDate),
          );
          return JSON.stringify(parMois) === JSON.stringify(parJour);
        },
      ),
    );
  });
});
