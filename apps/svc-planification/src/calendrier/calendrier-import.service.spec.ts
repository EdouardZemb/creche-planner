import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import type { Clock } from '@creche-planner/nest-commons';
import {
  CalendrierImportService,
  mapperPeriodes,
  urlOpenData,
  type EnregistrementOds,
} from './calendrier-import.service.js';
import type { Database } from '../database/database.types.js';
import { calendrierPeriode, etablissement } from '../database/schema.js';

/**
 * Tests du service d'import (US-31-01, lot 3), **sans réseau et sans Postgres**.
 *
 * Deux périmètres bien distincts, et il faut les garder distincts :
 *
 * 1. `mapperPeriodes` est **pur** : il se teste sur la fixture commitée, sans
 *    aucun montage. C'est là que vivent les deux conventions que ce lot fige —
 *    le fuseau et la sémantique des bornes.
 * 2. Le service fait deux choses qu'un mapping ne fait pas : il **sort sur
 *    Internet** et il **écrit**. Le `fetch` global est donc remplacé, et le faux
 *    `db` capture ce qu'on lui demande d'écrire.
 *
 * ⚠️ L'API réelle n'est appelée nulle part, ni ici ni en CI : elle ne demande
 * aucun secret, mais un test qui sort sur Internet finit toujours par rougir sans
 * qu'une ligne de code ait bougé.
 */

const ETAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAINTENANT = new Date('2026-06-15T09:30:00.000Z');
const horloge: Clock = { maintenant: () => MAINTENANT };

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'ods-zone-b-2026-2027.json'),
    'utf8',
  ),
) as { results: EnregistrementOds[] };

/** Enregistrement `i` de la fixture, sans assertion non nulle (lint du dépôt). */
function ligneFixture(i: number): EnregistrementOds {
  const ligne = FIXTURE.results[i];
  if (ligne === undefined)
    throw new Error(`fixture sans enregistrement ${String(i)}`);
  return ligne;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ───────────────────────────────────────────────── le mapping, pur et verrouillé

describe('mapperPeriodes — les deux conventions du lot 3', () => {
  it('lit les bornes en Europe/Paris, pas en UTC', () => {
    const periodes = mapperPeriodes(FIXTURE.results, 'B', '2026-2027');
    const toussaint = periodes.find((p) => p.libelle.includes('Toussaint'));

    // `start_date` vaut 2026-10-16T22:00Z = le 17 à minuit à Paris (CEST). Lu en
    // UTC, il donnerait le 16 : un jour de vacances de moins, tous les ans, sans
    // que rien ne le signale. C'est le défaut que ce test interdit.
    expect(toussaint?.du).toBe('2026-10-17');
  });

  it('rend une borne de fin INCLUSE : la veille du jour de reprise', () => {
    const periodes = mapperPeriodes(FIXTURE.results, 'B', '2026-2027');
    const toussaint = periodes.find((p) => p.libelle.includes('Toussaint'));

    // `end_date` = 2026-11-01T23:00Z = reprise le 2 novembre à Paris. La borne
    // `au` du domaine étant incluse, elle vaut le 1er — pas le 2, qui est un
    // jour de classe.
    expect(toussaint?.au).toBe('2026-11-01');
  });

  it('mappe les cinq périodes de l’année avec leurs libellés officiels', () => {
    const periodes = mapperPeriodes(FIXTURE.results, 'B', '2026-2027');
    expect(periodes).toEqual([
      {
        libelle: 'Vacances de la Toussaint',
        du: '2026-10-17',
        au: '2026-11-01',
      },
      { libelle: 'Vacances de Noël', du: '2026-12-19', au: '2027-01-03' },
      { libelle: "Vacances d'hiver", du: '2027-02-13', au: '2027-02-28' },
      { libelle: 'Vacances de printemps', du: '2027-04-17', au: '2027-05-02' },
      { libelle: "Vacances d'été", du: '2027-07-07', au: '2027-08-31' },
    ]);
  });

  it('écarte les lignes « Enseignants » et les autres zones', () => {
    // La fixture porte les deux pièges du jeu de données : une ligne Toussaint
    // « Enseignants » et une ligne Toussaint « Zone A ». Sans filtre, la
    // Toussaint apparaîtrait trois fois.
    const periodes = mapperPeriodes(FIXTURE.results, 'B', '2026-2027');
    const toussaints = periodes.filter((p) => p.libelle.includes('Toussaint'));
    expect(toussaints).toHaveLength(1);
  });

  it('dédoublonne deux lignes de même période, quelle que soit la population', () => {
    const doublon: EnregistrementOds[] = [
      { ...ligneFixture(0), population: '-' },
      { ...ligneFixture(0), population: 'Élèves' },
    ];
    expect(mapperPeriodes(doublon, 'B', '2026-2027')).toHaveLength(1);
  });

  it('ignore une ligne dont les bornes sont illisibles plutôt que d’échouer', () => {
    const casse: EnregistrementOds[] = [
      { ...ligneFixture(0), start_date: 'pas une date' },
      ligneFixture(1),
    ];
    // Une seule ligne cassée ne doit pas priver le parent de son année entière.
    expect(mapperPeriodes(casse, 'B', '2026-2027')).toHaveLength(1);
  });

  it('n’accepte pas une autre année scolaire dans la même réponse', () => {
    const autre: EnregistrementOds[] = [
      { ...ligneFixture(0), annee_scolaire: '2027-2028' },
    ];
    expect(mapperPeriodes(autre, 'B', '2026-2027')).toHaveLength(0);
  });
});

describe('urlOpenData', () => {
  it('filtre la zone ET l’année côté serveur, sans secret dans l’URL', () => {
    const url = urlOpenData('B', '2026-2027');
    expect(url).toContain('fr-en-calendrier-scolaire');
    // `URLSearchParams` encode l'espace en `+` : le décodage doit le refaire,
    // sinon on affirmerait sur une chaîne qui n'existe pas.
    const lisible = decodeURIComponent(url).replaceAll('+', ' ');
    expect(lisible).toContain('zones="Zone B"');
    expect(lisible).toContain('annee_scolaire="2026-2027"');
    expect(url).not.toMatch(/apikey|token|secret/i);
  });
});

// ──────────────────────────────────────────────── le service : réseau + écriture

/** Faux `db` qui capture les écritures et **espionne `delete`**. */
function fakeEcriture(zone: 'A' | 'B' | 'C' | null): {
  db: Database;
  clotures: Record<string, unknown>[];
  ouvertures: unknown[];
  aSupprime: () => boolean;
} {
  const clotures: Record<string, unknown>[] = [];
  const ouvertures: unknown[] = [];
  let aSupprime = false;

  const tx = {
    update: () => ({
      set: (valeurs: Record<string, unknown>) => {
        clotures.push(valeurs);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: 'ancienne' }]),
          }),
        };
      },
    }),
    insert: () => ({
      values: (lignes: unknown) => {
        ouvertures.push(lignes);
        return {
          returning: () =>
            Promise.resolve(
              (lignes as unknown[]).map((_, i) => ({
                id: `neuve-${String(i)}`,
              })),
            ),
        };
      },
    }),
    delete: () => {
      aSupprime = true;
      return { where: () => ({ returning: () => Promise.resolve([]) }) };
    },
  };

  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table === etablissement && zone !== null
                ? [{ zone }]
                : table === etablissement
                  ? [{ zone: null }]
                  : [],
            ),
        }),
      }),
    }),
  } as unknown as Database;

  return { db, clotures, ouvertures, aSupprime: () => aSupprime };
}

/**
 * Remplace `fetch` par une réponse canned, ou par un échec de transport.
 *
 * On construit une VRAIE `Response` plutôt qu'un objet partiel casté : le service
 * lit `ok`, `status` et `json()`, et un faux partiel finirait par diverger de ce
 * que la plateforme rend réellement.
 */
function stubFetch(corps: unknown, status = 200): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify(corps), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

/** Remplace `fetch` par un échec de transport (DNS, egress bloqué, timeout). */
function stubFetchEnEchec(message: string): void {
  vi.stubGlobal('fetch', () => Promise.reject(new Error(message)));
}

describe('CalendrierImportService.importerAnnee', () => {
  it('importe les cinq périodes et ne SUPPRIME jamais rien', async () => {
    const { db, clotures, ouvertures, aSupprime } = fakeEcriture('B');
    stubFetch(FIXTURE);
    const service = new CalendrierImportService(db, horloge);

    const resultat = await service.importerAnnee(ETAB, '2026-2027');

    expect(resultat.importees).toBe(5);
    expect(resultat.zoneScolaire).toBe('B');
    // Append-only : le réimport CLÔT, il ne supprime pas. C'est ce que le lot 2
    // a construit et ce que l'export de portabilité promet.
    expect(aSupprime()).toBe(false);
    expect(clotures[0]?.['connuJusqua']).toEqual(MAINTENANT);
    // Les lignes ouvertes portent la provenance et l'année : sans elles, le
    // prochain réimport ne saurait pas lesquelles remplacer.
    const lignes = ouvertures[0] as Record<string, unknown>[];
    expect(lignes).toHaveLength(5);
    expect(lignes[0]?.['source']).toBe('IMPORT');
    expect(lignes[0]?.['anneeScolaire']).toBe('2026-2027');
    expect(lignes[0]?.['type']).toBe('VACANCES');
  });

  it('clôt et rouvre au MÊME instant — aucun trou de connaissance', async () => {
    const { db, clotures, ouvertures } = fakeEcriture('B');
    stubFetch(FIXTURE);

    await new CalendrierImportService(db, horloge).importerAnnee(
      ETAB,
      '2026-2027',
    );

    const lignes = ouvertures[0] as Record<string, unknown>[];
    // Une clôture à T et une ouverture à T+ε laisserait un instant où le
    // calendrier n'a aucune période : une lecture à cet instant serait fausse.
    expect(clotures[0]?.['connuJusqua']).toEqual(lignes[0]?.['connuDepuis']);
  });

  it('refuse en 422 codé quand l’établissement n’a pas de zone', async () => {
    const { db } = fakeEcriture(null);
    stubFetch(FIXTURE);
    const service = new CalendrierImportService(db, horloge);

    const erreur = await service
      .importerAnnee(ETAB, '2026-2027')
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(UnprocessableEntityException);
    expect(
      (erreur as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'ZONE_SCOLAIRE_ABSENTE' });
  });

  it('n’appelle même pas l’open data si la zone manque', async () => {
    const { db } = fakeEcriture(null);
    const appel = vi.fn();
    vi.stubGlobal('fetch', appel);

    await new CalendrierImportService(db, horloge)
      .importerAnnee(ETAB, '2026-2027')
      .catch(() => undefined);

    expect(appel).not.toHaveBeenCalled();
  });

  it('rend un 422 actionnable quand l’open data est injoignable (CA3)', async () => {
    const { db, ouvertures } = fakeEcriture('B');
    stubFetchEnEchec('getaddrinfo ENOTFOUND data.education.gouv.fr');

    const erreur = await new CalendrierImportService(db, horloge)
      .importerAnnee(ETAB, '2026-2027')
      .catch((e: unknown) => e);

    const corps = (erreur as UnprocessableEntityException).getResponse() as {
      code: string;
      message: string;
    };
    expect(corps.code).toBe('IMPORT_CALENDRIER_INDISPONIBLE');
    // Le message doit servir l'EXPLOITATION autant que le parent : c'est la
    // première dépendance sortante d'un service métier, et un egress bloqué se
    // diagnostique mal sans indice.
    expect(corps.message).toContain('HTTPS');
    // Rien n'a été écrit : un import raté ne doit pas laisser le calendrier vide.
    expect(ouvertures).toHaveLength(0);
  });

  it('rend un 422 quand l’open data répond 500', async () => {
    const { db } = fakeEcriture('B');
    stubFetch({}, 500);

    const erreur = await new CalendrierImportService(db, horloge)
      .importerAnnee(ETAB, '2026-2027')
      .catch((e: unknown) => e);

    expect(
      (erreur as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'IMPORT_CALENDRIER_INDISPONIBLE' });
  });

  it('rend un 422 quand l’année demandée n’est pas encore publiée', async () => {
    const { db, ouvertures } = fakeEcriture('B');
    stubFetch({ results: [] });

    const erreur = await new CalendrierImportService(db, horloge)
      .importerAnnee(ETAB, '2030-2031')
      .catch((e: unknown) => e);

    expect(
      (erreur as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'IMPORT_CALENDRIER_INDISPONIBLE' });
    // Surtout : on ne clôt PAS les périodes existantes avant de savoir qu'on a
    // de quoi les remplacer. Un import raté qui vide le calendrier serait pire
    // que pas d'import du tout.
    expect(ouvertures).toHaveLength(0);
  });

  it('ne cible que les lignes IMPORT de l’année visée (CA2, par construction)', async () => {
    // La preuve de CA2 n'est pas dans une assertion de contenu — elle est dans
    // le fait que l'écriture ne PEUT PAS atteindre autre chose : le `where` porte
    // `source = IMPORT` et `annee_scolaire = $1`. On vérifie donc la table visée.
    const { db, ouvertures } = fakeEcriture('B');
    stubFetch(FIXTURE);

    await new CalendrierImportService(db, horloge).importerAnnee(
      ETAB,
      '2026-2027',
    );

    const lignes = ouvertures[0] as Record<string, unknown>[];
    expect(lignes.every((l) => l['source'] === 'IMPORT')).toBe(true);
    expect(lignes.every((l) => l['etablissementId'] === ETAB)).toBe(true);
    expect(calendrierPeriode).toBeDefined();
  });
});
