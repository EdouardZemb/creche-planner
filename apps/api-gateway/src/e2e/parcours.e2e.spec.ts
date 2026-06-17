import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Test **E2E API** de la DoD Phase 7 : le parcours orienté écran
 * « créer foyer + contrats → lire le coût du mois » de bout en bout, à travers le
 * **bundle réel** de la gateway (validation, versionnage `/v1`, auth, agrégation,
 * clients résilients).
 *
 * Comme les vérifications Pact provider (doc 06 §8.8), on **démarre le bundle
 * webpack** (`dist/main.js`) en sous-processus — booter Nest in-process sous vitest
 * casse l'injection (esbuild n'émet pas les métadonnées de décorateurs). Les trois
 * services aval (foyer/planification/tarification) sont **simulés** par un petit
 * serveur HTTP local vers lequel pointent `FOYER_URL`/`PLANIFICATION_URL`/
 * `TARIFICATION_URL`. Aucun Docker requis ; ignoré si le bundle n'a pas été buildé.
 */

const FOYER_ID = '22222222-2222-2222-2222-222222222222';
const CONTRAT_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Nombre de `PUT /api/contrats/:id` effectivement reçus par le service aval
 * (simulé). Sert à vérifier l'invariant MBT : un 429 du rate-limit gateway
 * court-circuite AVANT le contrôleur, donc le service aval n'est jamais appelé
 * (le contrat ne peut pas être modifié/supprimé par un PUT « fantôme »).
 */
let putContratsRecus = 0;

/** Vue foyer renvoyée par le faux `svc-foyer` (foyer de référence doc 02 §0 → T3). */
const FOYER_VUE = {
  id: FOYER_ID,
  ressourcesMensuellesCentimes: 671692,
  ressourcesMensuellesEuros: 6716.92,
  rfrCentimes: 7270500,
  rfrEuros: 72705,
  nbEnfantsACharge: 2,
  nbParts: 3,
  tranche: 3,
};

/** Coût d'octobre 2026 : cantine 16 j × 12,68 € = 202,88 € (20288 c., CT-10). */
const COUT_MOIS_VUE = {
  foyerId: FOYER_ID,
  mois: '2026-10',
  simule: false,
  totalCentimes: 20288,
  prestations: [
    {
      enfant: 'Zoé',
      mode: 'CANTINE',
      totalCentimes: 20288,
      lignes: [{ libelle: 'Cantine', sens: 'debit', montantCentimes: 20288 }],
    },
  ],
  lignes: [{ libelle: 'Cantine', sens: 'debit', montantCentimes: 20288 }],
};

// nx lance vitest avec cwd = racine du projet (apps/api-gateway).
const BUNDLE = resolve(process.cwd(), 'dist/main.js');

/** Serveur HTTP simulant les trois services aval (chemins disjoints). */
function gererAval(req: IncomingMessage, res: ServerResponse): void {
  let corpsBrut = '';
  req.on('data', (morceau) => (corpsBrut += String(morceau)));
  req.on('end', () => {
    const url = req.url ?? '';
    const methode = (req.method ?? 'GET').toUpperCase();
    const corps = (corpsBrut ? JSON.parse(corpsBrut) : {}) as Record<
      string,
      unknown
    >;
    const envoyer = (statut: number, donnees: unknown): void => {
      res.writeHead(statut, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(donnees));
    };

    if (methode === 'POST' && url === '/api/foyers') {
      return envoyer(201, FOYER_VUE);
    }
    if (methode === 'POST' && /^\/api\/foyers\/[^/]+\/enfants$/.test(url)) {
      return envoyer(201, {
        id: `enfant-${String(corps['prenom'])}`,
        foyerId: FOYER_ID,
        prenom: corps['prenom'],
        dateNaissance: corps['dateNaissance'],
      });
    }
    if (methode === 'POST' && url === '/api/contrats') {
      return envoyer(201, {
        id: CONTRAT_ID,
        foyerId: corps['foyerId'],
        enfant: corps['enfant'],
        mode: corps['mode'],
        valideDu: corps['valideDu'],
        valideAu: corps['valideAu'] ?? null,
      });
    }
    if (methode === 'PUT' && /^\/api\/contrats\/[^/]+$/.test(url)) {
      // Compte les modifications de contrat qui atteignent VRAIMENT l'aval.
      putContratsRecus += 1;
      return envoyer(200, {
        id: CONTRAT_ID,
        foyerId: corps['foyerId'],
        enfant: corps['enfant'],
        mode: corps['mode'],
        valideDu: corps['valideDu'],
        valideAu: corps['valideAu'] ?? null,
      });
    }
    if (methode === 'GET' && url.startsWith('/api/couts')) {
      return envoyer(200, COUT_MOIS_VUE);
    }
    envoyer(500, { message: `aval non simulé : ${methode} ${url}` });
  });
}

function trouverPortLibre(): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const serveur = createServer();
    serveur.listen(0, () => {
      const port = (serveur.address() as AddressInfo).port;
      serveur.close((erreur) => (erreur ? rejeter(erreur) : resoudre(port)));
    });
  });
}

async function attendreReadiness(url: string, delaiMs = 30000): Promise<void> {
  const echeance = Date.now() + delaiMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // pas encore à l'écoute
    }
    if (Date.now() > echeance) {
      throw new Error(`gateway non prête après ${delaiMs} ms (${url})`);
    }
    await sleep(300);
  }
}

interface Gateway {
  readonly proc: ChildProcess;
  readonly base: string;
}

describe('E2E API · parcours « créer foyer + contrats → lire le coût »', () => {
  const bundlePresent = existsSync(BUNDLE);
  let stub: Server | undefined;
  let stubBase = '';
  let gw: Gateway | undefined;

  async function demarrerGateway(
    extra: Record<string, string>,
  ): Promise<Gateway> {
    const port = await trouverPortLibre();
    const proc = spawn(process.execPath, [BUNDLE], {
      env: {
        ...process.env,
        PORT: String(port),
        FOYER_URL: stubBase,
        PLANIFICATION_URL: stubBase,
        TARIFICATION_URL: stubBase,
        REFERENTIEL_URL: stubBase,
        OTEL_SDK_DISABLED: 'true',
        ...extra,
      },
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    await attendreReadiness(`${base}/api/health/live`);
    return { proc, base };
  }

  beforeAll(async () => {
    if (!bundlePresent) {
      return; // bundle non buildé : on saute (cf. ctx.skip ci-dessous)
    }
    const portStub = await trouverPortLibre();
    const serveur = createServer(gererAval);
    stub = serveur;
    await new Promise<void>((resoudre) => serveur.listen(portStub, resoudre));
    stubBase = `http://127.0.0.1:${portStub}`;
    gw = await demarrerGateway({}); // GATEWAY_TOKEN absent → auth désactivée
  }, 45000);

  afterAll(async () => {
    gw?.proc.kill('SIGTERM');
    await new Promise<void>((resoudre) => {
      if (!stub) {
        return resoudre();
      }
      stub.close(() => resoudre());
    });
  });

  it('crée le dossier foyer (foyer + 2 enfants) et déduit la tranche T3', async (ctx) => {
    if (!gw) {
      return ctx.skip();
    }
    const reponse = await fetch(`${gw.base}/api/v1/foyers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
        enfants: [
          { prenom: 'Mia', dateNaissance: '2024-12-08' },
          { prenom: 'Zoé', dateNaissance: '2023-03-12' },
        ],
      }),
    });
    expect(reponse.status).toBe(201);
    const corps = (await reponse.json()) as {
      foyer: { id: string; tranche: number };
      enfants: { prenom: string }[];
    };
    expect(corps.foyer.id).toBe(FOYER_ID);
    expect(corps.foyer.tranche).toBe(3);
    expect(corps.enfants.map((e) => e.prenom)).toEqual(['Mia', 'Zoé']);
  });

  it('crée un contrat cantine ABCM pour Zoé', async (ctx) => {
    if (!gw) {
      return ctx.skip();
    }
    const reponse = await fetch(`${gw.base}/api/v1/contrats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'CANTINE',
        foyerId: FOYER_ID,
        enfant: 'Zoé',
        valideDu: '2026-09-01',
        valideAu: null,
        semaineAbcm: { LUNDI: { cantine: true } },
      }),
    });
    expect(reponse.status).toBe(201);
    const corps = (await reponse.json()) as { id: string; mode: string };
    expect(corps.id).toBe(CONTRAT_ID);
    expect(corps.mode).toBe('CANTINE');
  });

  it('lit le coût consolidé du mois (CT-10 = 20288 c.)', async (ctx) => {
    if (!gw) {
      return ctx.skip();
    }
    const reponse = await fetch(
      `${gw.base}/api/v1/couts?foyer=${FOYER_ID}&mois=2026-10&simule=false`,
    );
    expect(reponse.status).toBe(200);
    const corps = (await reponse.json()) as {
      foyerId: string;
      totalCentimes: number;
      prestations: { mode: string }[];
    };
    expect(corps.foyerId).toBe(FOYER_ID);
    expect(corps.totalCentimes).toBe(20288);
    expect(corps.prestations[0]?.mode).toBe('CANTINE');
  });

  it('rejette une saisie foyer invalide en 400 (validation BFF)', async (ctx) => {
    if (!gw) {
      return ctx.skip();
    }
    const reponse = await fetch(`${gw.base}/api/v1/foyers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ressourcesMensuelles: -1, rfr: 72705 }),
    });
    expect(reponse.status).toBe(400);
  });

  it('publie la spécification OpenAPI sans jeton (route publique)', async (ctx) => {
    if (!gw) {
      return ctx.skip();
    }
    const reponse = await fetch(`${gw.base}/api/openapi.json`);
    expect(reponse.status).toBe(200);
    const corps = (await reponse.json()) as { openapi: string };
    expect(corps.openapi).toBe('3.1.0');
  });

  it('exige le jeton d’API quand GATEWAY_TOKEN est défini', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const securisee = await demarrerGateway({ GATEWAY_TOKEN: 'secret-test' });
    try {
      const sansJeton = await fetch(
        `${securisee.base}/api/v1/couts?foyer=${FOYER_ID}&mois=2026-10`,
      );
      expect(sansJeton.status).toBe(401);

      const avecJeton = await fetch(
        `${securisee.base}/api/v1/couts?foyer=${FOYER_ID}&mois=2026-10`,
        { headers: { Authorization: 'Bearer secret-test' } },
      );
      expect(avecJeton.status).toBe(200);
    } finally {
      securisee.proc.kill('SIGTERM');
    }
  }, 45000);

  // Invariant MBT : un 429 du rate-limit gateway sur `PUT /contrats/:id` doit
  // court-circuiter AVANT le contrôleur → le service aval n'est jamais appelé,
  // donc le contrat existant ne peut être ni modifié ni supprimé par ce PUT.
  it('un 429 sur PUT /contrats/:id n’atteint jamais le service aval (contrat préservé)', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    // Quota volontairement bas (fenêtre large) pour provoquer des 429 à coup sûr.
    const limitee = await demarrerGateway({
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_FENETRE_MS: '60000',
    });
    try {
      const avant = putContratsRecus;
      const statuts: number[] = [];
      // Bombarde la même IP : au-delà du quota, la gateway répond 429.
      for (let i = 0; i < 20; i++) {
        const res = await fetch(
          `${limitee.base}/api/v1/contrats/${CONTRAT_ID}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'CANTINE',
              foyerId: FOYER_ID,
              enfant: 'Zoé',
              valideDu: '2026-09-01',
              valideAu: null,
              semaineAbcm: { LUNDI: { cantine: true } },
            }),
          },
        );
        statuts.push(res.status);
      }
      const recusParAval = putContratsRecus - avant;
      const nb429 = statuts.filter((s) => s === 429).length;
      const nb2xx = statuts.filter((s) => s >= 200 && s < 300).length;

      // Le rate-limit a bien déclenché…
      expect(nb429).toBeGreaterThan(0);
      // …et CHAQUE 429 a court-circuité l'aval : le service ne reçoit que les
      // PUT acceptés (jamais un PUT « fantôme » qui toucherait le contrat).
      expect(recusParAval).toBe(nb2xx);
    } finally {
      limitee.proc.kill('SIGTERM');
    }
  }, 45000);
});
