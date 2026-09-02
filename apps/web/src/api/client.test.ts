import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, AuthExpiredError } from './client';

// Le client n'est pas mocké ici : on stubbe `fetch` pour vérifier la mécanique
// transverse (redirect: 'manual', classification des redirections Access vs
// erreurs HTTP). Un seul endpoint (lireFoyer) suffit, tous passent par le même
// wrapper `requete`.

const fetchMock = vi.fn();

/** Réponse JSON ordinaire (type 'basic'), comme en dev/LAN sans Access. */
function reponse(
  status: number,
  corps?: unknown,
  entetes?: Record<string, string>,
): Response {
  return {
    type: 'basic',
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(entetes),
    json: () =>
      corps === undefined
        ? Promise.reject(new Error('pas de corps'))
        : Promise.resolve(corps),
  } as unknown as Response;
}

/** Réponse opaque produite par un navigateur sur redirection avec redirect:'manual'. */
function reponseOpaqueRedirect(): Response {
  return {
    type: 'opaqueredirect',
    ok: false,
    status: 0,
    headers: new Headers(),
    json: () => Promise.reject(new Error('réponse opaque')),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client API — détection de session Access expirée', () => {
  it('passe redirect:"manual" à fetch (sinon le 302 Access casse en CORS)', async () => {
    fetchMock.mockResolvedValue(
      reponse(200, { foyer: { id: 'f1' }, enfants: [] }),
    );

    await api.lireFoyer('f1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/foyers/f1',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('réponse 200 → données rendues (comportement nominal inchangé)', async () => {
    const dossier = { foyer: { id: 'f1' }, enfants: [] };
    fetchMock.mockResolvedValue(reponse(200, dossier));

    await expect(api.lireFoyer('f1')).resolves.toEqual(dossier);
  });

  it('réponse 404 → ApiError(404) (comportement actuel inchangé)', async () => {
    fetchMock.mockResolvedValue(reponse(404, undefined));

    await expect(api.lireFoyer('inconnu')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });

  it('redirection opaque (navigateur) → AuthExpiredError', async () => {
    fetchMock.mockResolvedValue(reponseOpaqueRedirect());

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('302 visible vers *.cloudflareaccess.com → AuthExpiredError', async () => {
    fetchMock.mockResolvedValue(
      reponse(302, undefined, {
        location:
          'https://mon-equipe.cloudflareaccess.com/cdn-cgi/access/login/creche.testlens.dev',
      }),
    );

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('302 visible vers une autre destination → ApiError (pas une session expirée)', async () => {
    fetchMock.mockResolvedValue(
      reponse(302, undefined, { location: 'https://exemple.fr/ailleurs' }),
    );

    const echec = api.lireFoyer('f1');
    await expect(echec).rejects.toBeInstanceOf(ApiError);
    await expect(echec).rejects.not.toBeInstanceOf(AuthExpiredError);
  });

  it('302 sans en-tête Location (ou Location illisible) → ApiError', async () => {
    fetchMock.mockResolvedValueOnce(reponse(302, undefined));
    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(
      reponse(302, undefined, { location: '::pas-une-url::' }),
    );
    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(ApiError);
  });

  it('échec réseau persistant (TypeError) → rejoué puis propagé (classé indisponible en aval)', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const p = api.lireFoyer('f1');
      const attente = expect(p).rejects.toBeInstanceOf(TypeError);
      // Laisse les deux backoffs (500 ms + 1,5 s) s'écouler.
      await vi.advanceTimersByTimeAsync(500 + 1500);
      await attente;

      // 1 tentative initiale + 2 rejeux bornés, puis abandon.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

// La résilience (retry borné + délai d'expiration) ne s'applique qu'aux appels
// idempotents : GET (ici lireFoyer) et écritures rejouables sans double effet
// (ecrireSemaineBesoins = upsert, validerSemaine = idempotente par clé unique).
// Les backoffs (500 ms / 1,5 s) sont pilotés par des timers factices.
describe('client API — résilience réseau (retry borné + timeout)', () => {
  const dossier = { foyer: { id: 'f1' }, enfants: [] };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET : un hoquet réseau (TypeError) est rejoué → succès à la 2e tentative', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reponse(200, dossier));

    const p = api.lireFoyer('f1');
    const attente = expect(p).resolves.toEqual(dossier);
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET : une 503 transitoire est rejouée → succès à la 2e tentative', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse(503, undefined))
      .mockResolvedValueOnce(reponse(200, dossier));

    const p = api.lireFoyer('f1');
    const attente = expect(p).resolves.toEqual(dossier);
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET : le nombre de rejeux est borné (3 tentatives au total)', async () => {
    fetchMock.mockResolvedValue(reponse(502, undefined));

    const p = api.lireFoyer('f1');
    const attente = expect(p).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(500 + 1500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('GET : une 4xx n’est JAMAIS rejouée (erreur applicative)', async () => {
    fetchMock.mockResolvedValue(reponse(409, undefined));

    await expect(api.lireFoyer('f1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET : une session Access expirée (redirection opaque) n’est pas rejouée', async () => {
    fetchMock.mockResolvedValue(reponseOpaqueRedirect());

    await expect(api.lireFoyer('f1')).rejects.toBeInstanceOf(AuthExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET : chaque requête porte un AbortSignal (délai d’expiration câblé)', async () => {
    fetchMock.mockResolvedValue(reponse(200, dossier));

    await api.lireFoyer('f1');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('GET : l’abandon de l’appelant pendant le backoff stoppe les rejeux', async () => {
    const ctrl = new AbortController();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(reponse(200, dossier));

    const p = api.lireFoyer('f1', { signal: ctrl.signal });
    const attente = expect(p).rejects.toBeInstanceOf(DOMException);
    // Laisse la 1re tentative échouer et entrer dans l'attente du backoff.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    ctrl.abort();
    await attente;
    // Pas de nouvelle tentative après abandon.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ecrireSemaineBesoins (upsert) : rejoué sur 502, corps rejoué à l’identique', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse(502, undefined))
      .mockResolvedValueOnce(reponse(204, undefined));

    const p = api.ecrireSemaineBesoins('c-1', '2026-W27', { absences: [] });
    const attente = expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init1 = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const init2 = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(init1.method).toBe('PUT');
    expect(init1.body).toBe(JSON.stringify({ absences: [] }));
    // Rejeu à l'identique (même corps, mêmes en-têtes).
    expect(init2.body).toBe(init1.body);
  });

  it('ecrirePlanning (upsert mensuel) : rejoué sur 503 → succès à la 2e tentative', async () => {
    fetchMock
      .mockResolvedValueOnce(reponse(503, undefined))
      .mockResolvedValueOnce(reponse(204, undefined));

    const p = api.ecrirePlanning('c-1', '2026-07', false, { absences: [] });
    const attente = expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init1 = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init1.method).toBe('PUT');
    expect(init1.body).toBe(JSON.stringify({ absences: [] }));
  });

  it('validerSemaine (idempotente par clé unique) : rejouée sur TypeError', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reponse(200, { statut: 'validee' }));

    const p = api.validerSemaine('c-1', '2026-W27');
    const attente = expect(p).resolves.toEqual({ statut: 'validee' });
    await vi.advanceTimersByTimeAsync(500);
    await attente;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('écriture NON idempotente (supprimerContrat) : ni rejeu ni signal ajouté', async () => {
    fetchMock.mockResolvedValue(reponse(503, undefined));

    await expect(api.supprimerContrat('c-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
    });
    // Aucun rejeu : comportement inchangé pour les écritures non rejouables.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });
});

// --- Versionnement du contrat (SFD 30 lot 5) --------------------------------

describe('client API — avenants, historique, correction (SFD 30)', () => {
  it('creerAvenant : POST /contrats/:id/versions avec le corps JSON', async () => {
    const vue = { id: 'c-1', mode: 'CRECHE_PSU' };
    fetchMock.mockResolvedValue(reponse(201, vue));

    await expect(
      api.creerAvenant('c-1', {
        mode: 'CRECHE_PSU',
        dateEffet: '2026-09-01',
        heuresAnnuellesContractualisees: 700,
        nbMensualites: 7,
        semaineType: {},
      }),
    ).resolves.toEqual(vue);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/contrats/c-1/versions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      dateEffet: '2026-09-01',
    });
  });

  it('creerAvenant : un 409 remonte en ApiError (date déjà prise)', async () => {
    fetchMock.mockResolvedValue(reponse(409, { message: 'conflit' }));
    await expect(
      api.creerAvenant('c-1', {
        mode: 'CRECHE_PSU',
        dateEffet: '2026-09-01',
        heuresAnnuellesContractualisees: 700,
        nbMensualites: 7,
        semaineType: {},
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 409 });
  });

  it('listerVersions : GET /contrats/:id/versions', async () => {
    fetchMock.mockResolvedValue(reponse(200, [{ id: 'v-1' }]));
    await expect(api.listerVersions('c-1')).resolves.toEqual([{ id: 'v-1' }]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/contrats/c-1/versions');
  });

  it('apercuImpact : GET /contrats/:id/versions/:versionId/impact', async () => {
    const impact = {
      versionId: 'v-1',
      moisCouverts: ['2026-06'],
      moisCommuniques: [],
    };
    fetchMock.mockResolvedValue(reponse(200, impact));
    await expect(api.apercuImpact('c-1', 'v-1')).resolves.toEqual(impact);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/contrats/c-1/versions/v-1/impact');
  });

  it('corrigerVersion : PUT /contrats/:id/versions/:versionId', async () => {
    const vue = { id: 'c-1' };
    fetchMock.mockResolvedValue(reponse(200, vue));
    await expect(
      api.corrigerVersion('c-1', 'v-1', {
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: 700,
        nbMensualites: 7,
        semaineType: {},
        motif: 'oubli',
      }),
    ).resolves.toEqual(vue);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/contrats/c-1/versions/v-1');
    expect(init.method).toBe('PUT');
  });
});

// --- Unités associatives (SFD 40) -------------------------------------------
//
// Les cinq appels UA sont MOCKÉS dans le test de l'écran (`UnitesAssociativesPage`) :
// c'est ici, et nulle part ailleurs, que leur URL, leur verbe et leur corps sont
// réellement vérifiés. Deux choix de conception sont en jeu, et se testent :
//   — le foyer voyage en QUERY (`?foyer=`), encodé, sur les cinq appels ;
//   — seul le GET est idempotent. La suppression, en particulier, ne doit JAMAIS
//     être rejouée : un second appel répond 404 et transformerait une suppression
//     réussie en « introuvable » (cf. le commentaire de `supprimerSessionUa`).

describe('client API — unités associatives (SFD 40)', () => {
  const engagement = {
    id: 'eng-1',
    foyerId: 'f-1',
    debut: '2026-06-01',
    fin: '2027-05-31',
    quotaHeures: 20,
    valeurUaCentimes: 3125,
    cautionCentimes: 62500,
  };

  const session = {
    id: 's-1',
    engagementId: 'eng-1',
    date: '2026-11-07',
    dureeHeures: 3,
    type: 'MENAGE',
    realisePar: 'Camille',
    etablissementId: null,
    etat: 'PREVUE',
    aConfirmer: false,
  };

  it('lireSuiviUnitesAssociatives : GET /v1/unites-associatives?foyer=', async () => {
    const vue = {
      foyerId: 'f-1',
      aujourdhui: '2026-10-01',
      engagement,
      compteurs: null,
      sessions: [],
      seuilAlerteJours: 56,
    };
    fetchMock.mockResolvedValue(reponse(200, vue));

    await expect(api.lireSuiviUnitesAssociatives('f-1')).resolves.toEqual(vue);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/unites-associatives?foyer=f-1');
    // Lecture : pas de corps, donc pas de Content-Type.
    expect(init.method).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('lireSuiviUnitesAssociatives : le foyer est ENCODÉ dans la query', async () => {
    fetchMock.mockResolvedValue(reponse(200, { sessions: [] }));

    await api.lireSuiviUnitesAssociatives('f/1 & 2');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/unites-associatives?foyer=f%2F1%20%26%202');
  });

  it('lireSuiviUnitesAssociatives : lecture idempotente → rejouée sur 503', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(reponse(503, undefined))
        .mockResolvedValueOnce(reponse(200, { sessions: [] }));

      const p = api.lireSuiviUnitesAssociatives('f-1');
      const attente = expect(p).resolves.toEqual({ sessions: [] });
      await vi.advanceTimersByTimeAsync(500);
      await attente;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('declarerEngagementUa : POST avec le corps JSON et son Content-Type', async () => {
    fetchMock.mockResolvedValue(reponse(201, engagement));

    const saisie = {
      debut: '2026-06-01',
      fin: '2027-05-31',
      quotaHeures: 20,
      valeurUaCentimes: 3125,
      cautionCentimes: 62500,
    };
    await expect(api.declarerEngagementUa('f-1', saisie)).resolves.toEqual(
      engagement,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/unites-associatives?foyer=f-1');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(saisie));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('declarerEngagementUa : un 409 (période qui se recouvre) remonte en ApiError', async () => {
    fetchMock.mockResolvedValue(
      reponse(409, { code: 'PERIODE_DEJA_DECLAREE' }),
    );

    await expect(
      api.declarerEngagementUa('f-1', {
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      corps: { code: 'PERIODE_DEJA_DECLAREE' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('declarerEngagementUa : une 503 n’est PAS rejouée (écriture non idempotente)', async () => {
    fetchMock.mockResolvedValue(reponse(503, undefined));

    await expect(
      api.declarerEngagementUa('f-1', {
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ajouterSessionUa : POST /v1/unites-associatives/sessions?foyer=', async () => {
    fetchMock.mockResolvedValue(reponse(201, session));

    const saisie = {
      engagementId: 'eng-1',
      date: '2026-11-07',
      dureeHeures: 3,
      type: 'MENAGE',
      realisePar: 'Camille',
    };
    await expect(api.ajouterSessionUa('f-1', saisie)).resolves.toEqual(session);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/unites-associatives/sessions?foyer=f-1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(saisie);
  });

  it('ajouterSessionUa : un 422 (date hors période) remonte en ApiError', async () => {
    fetchMock.mockResolvedValue(reponse(422, { code: 'DATE_HORS_PERIODE' }));

    await expect(
      api.ajouterSessionUa('f-1', {
        engagementId: 'eng-1',
        date: '2028-01-01',
        dureeHeures: 3,
        type: 'MENAGE',
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 422 });
  });

  it('modifierSessionUa : PUT …/sessions/:id?foyer= (l’id est encodé)', async () => {
    fetchMock.mockResolvedValue(reponse(200, { ...session, etat: 'REALISEE' }));

    await expect(
      api.modifierSessionUa('f-1', 's/1', { etat: 'REALISEE' }),
    ).resolves.toMatchObject({ etat: 'REALISEE' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/unites-associatives/sessions/s%2F1?foyer=f-1');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ etat: 'REALISEE' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('modifierSessionUa : un 404 (session inconnue pour ce foyer) remonte tel quel', async () => {
    fetchMock.mockResolvedValue(reponse(404, undefined));

    await expect(
      api.modifierSessionUa('f-1', 's-1', { etat: 'ANNULEE' }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 404 });
  });

  it('supprimerSessionUa : DELETE …/sessions/:id?foyer=, 204 → undefined', async () => {
    fetchMock.mockResolvedValue(reponse(204, undefined));

    await expect(api.supprimerSessionUa('f-1', 's-1')).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/unites-associatives/sessions/s-1?foyer=f-1');
    expect(init.method).toBe('DELETE');
    // Pas de corps → pas de Content-Type.
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('supprimerSessionUa : JAMAIS rejouée — un rejeu ferait un 404 d’un succès', async () => {
    fetchMock.mockResolvedValue(reponse(503, undefined));

    await expect(api.supprimerSessionUa('f-1', 's-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // `requete` et non `requeteIdempotente` : aucun signal de délai n’est câblé
    // d’office — seul celui de l’appelant, s’il en fournit un, est transmis.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });

  it('une écriture UA transmet l’abandon de l’appelant à fetch', async () => {
    const ctrl = new AbortController();
    fetchMock.mockResolvedValue(reponse(200, session));

    await api.ajouterSessionUa(
      'f-1',
      {
        engagementId: 'eng-1',
        date: '2026-11-07',
        dureeHeures: 3,
        type: 'MENAGE',
      },
      { signal: ctrl.signal },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });
});
