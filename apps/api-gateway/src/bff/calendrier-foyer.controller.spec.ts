import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CalendrierFoyerController } from './calendrier-foyer.controller.js';
import { FOYER_SCOPE_KEY } from '../security/foyer-scope.decorator.js';
import type { PlanificationClient } from '../clients/planification.client.js';

/**
 * Façade BFF du calendrier. Deux propriétés valent d'être prouvées ici, et elles
 * sont toutes les deux du genre à casser **en silence** :
 *
 * 1. **`aLaDate` traverse.** Le paramètre franchit quatre couches ; celle-ci le
 *    valide puis le relaie. Un `@Query()` non déclaré ou un `z.object` qui ne
 *    connaît pas la clé la fait disparaître **sans erreur** (`LE-48`) : la
 *    réponse resterait valide, mais résolue au mauvais instant de connaissance.
 * 2. **Chaque route porte `@FoyerScope`.** Une seule oubliée exposerait le
 *    calendrier d'un autre foyer. Le balayage part du prototype, donc il couvre
 *    aussi les routes ajoutées après ce lot.
 */

const ETAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANT = '2026-05-01T00:00:00.000Z';

function faux(): {
  controleur: CalendrierFoyerController;
  client: Record<string, ReturnType<typeof vi.fn>>;
} {
  const client = {
    lireCalendrier: vi.fn().mockResolvedValue({ jours: [] }),
    lireRecurrencesCalendrier: vi.fn().mockResolvedValue({ recurrences: [] }),
    remplacerRecurrencesCalendrier: vi
      .fn()
      .mockResolvedValue({ recurrences: [] }),
    lirePeriodesCalendrier: vi.fn().mockResolvedValue({ periodes: [] }),
    saisirPeriodeCalendrier: vi.fn().mockResolvedValue({ id: 'p' }),
    retoucherPeriodeCalendrier: vi.fn().mockResolvedValue({ id: 'p' }),
    clorePeriodeCalendrier: vi.fn().mockResolvedValue(undefined),
    lireExceptionsCalendrier: vi.fn().mockResolvedValue({ exceptions: [] }),
    poserExceptionCalendrier: vi.fn().mockResolvedValue({ id: 'e' }),
    cloreExceptionCalendrier: vi.fn().mockResolvedValue(undefined),
    importerCalendrier: vi.fn().mockResolvedValue({
      anneeScolaire: '2026-2027',
      zoneScolaire: 'B',
      importees: 5,
      remplacees: 0,
    }),
  };
  return {
    controleur: new CalendrierFoyerController(
      client as unknown as PlanificationClient,
    ),
    client,
  };
}

describe('CalendrierFoyerController — `aLaDate` ne se perd pas au BFF', () => {
  it('relaie l’instant de connaissance au client aval', async () => {
    const { controleur, client } = faux();
    await controleur.lire(ETAB, {
      du: '2026-03-02',
      au: '2026-03-31',
      aLaDate: INSTANT,
    });
    expect(client['lireCalendrier']).toHaveBeenCalledWith(
      ETAB,
      '2026-03-02',
      '2026-03-31',
      INSTANT,
    );
  });

  it('relaie `undefined` quand il est omis — jamais une chaîne vide', async () => {
    const { controleur, client } = faux();
    await controleur.lire(ETAB, { du: '2026-03-02', au: '2026-03-31' });
    expect(client['lireCalendrier']).toHaveBeenCalledWith(
      ETAB,
      '2026-03-02',
      '2026-03-31',
      undefined,
    );
  });

  it('relaie l’instant sur les trois couches brutes', async () => {
    const { controleur, client } = faux();
    await controleur.lireRecurrences(ETAB, { aLaDate: INSTANT });
    await controleur.lirePeriodes(ETAB, { aLaDate: INSTANT });
    await controleur.lireExceptions(ETAB, { aLaDate: INSTANT });
    expect(client['lireRecurrencesCalendrier']).toHaveBeenCalledWith(
      ETAB,
      INSTANT,
    );
    expect(client['lirePeriodesCalendrier']).toHaveBeenCalledWith(
      ETAB,
      INSTANT,
    );
    expect(client['lireExceptionsCalendrier']).toHaveBeenCalledWith(
      ETAB,
      INSTANT,
    );
  });
});

describe('CalendrierFoyerController — validation à la frontière', () => {
  // `valider` lève de façon SYNCHRONE, avant la moindre promesse : le refus est
  // donc un `throw`, pas un rejet. C'est ce qui garantit qu'aucun appel aval
  // n'est même tenté sur une entrée invalide.
  it('refuse une plage sans bornes (400 avant tout appel aval)', () => {
    const { controleur, client } = faux();
    expect(() => controleur.lire(ETAB, {})).toThrow(BadRequestException);
    expect(client['lireCalendrier']).not.toHaveBeenCalled();
  });

  it('refuse une période dont le corps est incomplet', () => {
    const { controleur, client } = faux();
    expect(() => controleur.saisirPeriode(ETAB, { type: 'VACANCES' })).toThrow(
      BadRequestException,
    );
    expect(client['saisirPeriodeCalendrier']).not.toHaveBeenCalled();
  });

  it('refuse un service hors catalogue dans une semaine type', () => {
    const { controleur, client } = faux();
    expect(() =>
      controleur.remplacerRecurrences(ETAB, {
        recurrences: [
          {
            regime: 'SCOLAIRE',
            jourSemaine: 'LUNDI',
            services: ['GARDERIE_DU_SOIR'],
          },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(client['remplacerRecurrencesCalendrier']).not.toHaveBeenCalled();
  });

  it('relaie une saisie de période valide', async () => {
    const { controleur, client } = faux();
    await controleur.saisirPeriode(ETAB, {
      type: 'VACANCES',
      libelle: 'Printemps',
      du: '2026-04-04',
      au: '2026-04-20',
    });
    expect(client['saisirPeriodeCalendrier']).toHaveBeenCalledOnce();
  });

  it('relaie la retouche et les deux clôtures', async () => {
    const { controleur, client } = faux();
    await controleur.retoucherPeriode(ETAB, 'p1', {
      type: 'VACANCES',
      libelle: 'Printemps',
      du: '2026-04-04',
      au: '2026-04-19',
    });
    await controleur.clorePeriode(ETAB, 'p1');
    await controleur.cloreException(ETAB, 'e1');
    expect(client['retoucherPeriodeCalendrier']).toHaveBeenCalledOnce();
    expect(client['clorePeriodeCalendrier']).toHaveBeenCalledWith(ETAB, 'p1');
    expect(client['cloreExceptionCalendrier']).toHaveBeenCalledWith(ETAB, 'e1');
  });

  it('relaie une pose d’exception valide', async () => {
    const { controleur, client } = faux();
    await controleur.poserException(ETAB, {
      jour: '2026-03-03',
      type: 'FERMETURE',
      libelle: 'Fermeture exceptionnelle',
    });
    expect(client['poserExceptionCalendrier']).toHaveBeenCalledOnce();
  });
});

describe('CalendrierFoyerController — portée par foyer', () => {
  const routes = Object.getOwnPropertyNames(
    CalendrierFoyerController.prototype,
  ).filter((nom) => nom !== 'constructor');

  it('voit bien les onze routes de la façade (sonde de la sonde)', () => {
    expect(routes).toHaveLength(11);
  });

  it('porte @FoyerScope(param:foyerId) sur CHAQUE route', () => {
    const handlers = CalendrierFoyerController.prototype as unknown as Record<
      string,
      object
    >;
    const sources = routes.flatMap((nom): unknown[] => {
      const handler = handlers[nom];
      return handler === undefined
        ? []
        : [Reflect.getMetadata(FOYER_SCOPE_KEY, handler)];
    });
    expect(sources).toEqual(Array.from({ length: 11 }, () => 'param:foyerId'));
  });
});

describe('CalendrierFoyerController — import d’une année (lot 3)', () => {
  it('valide l’année et relaie, sans jamais sortir sur Internet lui-même', async () => {
    const { controleur, client } = faux();
    const vue = await controleur.importerAnnee(ETAB, {
      anneeScolaire: '2026-2027',
    });
    expect(client['importerCalendrier']).toHaveBeenCalledWith(
      ETAB,
      '2026-2027',
    );
    expect(vue.importees).toBe(5);
  });

  it('refuse une année mal formée AVANT d’appeler l’aval', async () => {
    const { controleur, client } = faux();
    // `valider` lève AVANT tout `await` : la méthode n'est pas `async`, donc
    // l'exception est synchrone. L'attendre en `rejects` la manquerait.
    expect(() =>
      controleur.importerAnnee(ETAB, { anneeScolaire: '2026' }),
    ).toThrow(BadRequestException);
    // La validation à la frontière n'a de valeur que si elle ARRÊTE l'appel :
    // un 400 rendu après un aller-retour aval aurait déjà écrit.
    expect(client['importerCalendrier']).not.toHaveBeenCalled();
  });

  it('ignore une zone glissée dans le corps — elle vient de l’établissement', async () => {
    const { controleur, client } = faux();
    await controleur.importerAnnee(ETAB, {
      anneeScolaire: '2026-2027',
      zoneScolaire: 'A',
    });
    // Si la zone traversait, on pourrait poser un calendrier de zone A sur un
    // établissement de zone B — faux, et silencieux.
    expect(client['importerCalendrier']).toHaveBeenCalledWith(
      ETAB,
      '2026-2027',
    );
  });
});
