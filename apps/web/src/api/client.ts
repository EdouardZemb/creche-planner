import type {
  CreerDossierFoyer,
  DossierFoyerVue,
  FoyerVue,
  CreerContrat,
  ContratVue,
  ContratLocal,
  EcrirePlanning,
  LirePlanningReponse,
  CoutMoisVue,
  CoutAnnuelVue,
  EtablissementVue,
  MajEtablissement,
  NotificationAValider,
  ValidationResultat,
} from '../types/bff';

// Client HTTP du BFF. Base URL configurable via VITE_API_BASE_URL (défaut '/api',
// proxifié vers la gateway :3000 en dev). En-tête Authorization: Bearer ajouté
// seulement si VITE_GATEWAY_TOKEN est défini (auth gateway désactivée sinon).
const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const TOKEN = import.meta.env.VITE_GATEWAY_TOKEN;

/** Erreur HTTP non-2xx renvoyée par le BFF (corps = `[{champ,message}]` ou message). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly corps: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * Session d'authentification expirée (prod : Cloudflare Access redirige les
 * appels /api/v1/* vers sa page de connexion). À distinguer d'une panne :
 * réessayer ne sert à rien, il faut une vraie navigation réseau pour se
 * reconnecter (cf. `seReconnecter`).
 */
export class AuthExpiredError extends Error {
  constructor() {
    super('Session expirée, reconnectez-vous.');
    this.name = 'AuthExpiredError';
  }
}

/**
 * Une réponse de redirection sur l'API signe une session Access expirée :
 * le BFF ne renvoie jamais de 3xx. Avec `redirect: 'manual'`, le navigateur
 * matérialise toute redirection en réponse opaque (`type: 'opaqueredirect'`,
 * status 0) — sans cela, suivre le 302 cross-origin vers
 * *.cloudflareaccess.com échouerait en CORS (TypeError indistinguable d'une
 * panne réseau). Certains environnements (tests, runtimes non-navigateur)
 * exposent le 30x brut : on ne classe alors en session expirée que les
 * redirections vers Cloudflare Access, pour ne rien changer en dev/LAN.
 */
function estRedirectionAuth(res: Response): boolean {
  if (res.type === 'opaqueredirect') return true;
  if (res.status >= 300 && res.status < 400) {
    const destination = res.headers.get('location');
    if (!destination) return false;
    try {
      return new URL(destination).hostname.endsWith('.cloudflareaccess.com');
    } catch {
      return false;
    }
  }
  return false;
}

function requete(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, redirect: 'manual' }).then((res) => {
    if (estRedirectionAuth(res)) throw new AuthExpiredError();
    return res;
  });
}

function entetes(avecCorps: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (avecCorps) h['Content-Type'] = 'application/json';
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}

async function lire<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let corps: unknown;
    try {
      corps = await res.json();
    } catch {
      corps = undefined;
    }
    throw new ApiError(res.status, corps);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface RequeteOptions {
  signal?: AbortSignal;
}

export const api = {
  creerFoyer(
    saisie: CreerDossierFoyer,
    opts: RequeteOptions = {},
  ): Promise<DossierFoyerVue> {
    return requete(`${BASE}/v1/foyers`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<DossierFoyerVue>(r));
  },

  listerFoyers(opts: RequeteOptions = {}): Promise<FoyerVue[]> {
    return requete(`${BASE}/v1/foyers`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<FoyerVue[]>(r));
  },

  lireFoyer(id: string, opts: RequeteOptions = {}): Promise<DossierFoyerVue> {
    return requete(`${BASE}/v1/foyers/${encodeURIComponent(id)}`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<DossierFoyerVue>(r));
  },

  listerContrats(
    foyerId: string,
    opts: RequeteOptions = {},
  ): Promise<ContratLocal[]> {
    return requete(`${BASE}/v1/contrats?foyer=${encodeURIComponent(foyerId)}`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<ContratLocal[]>(r));
  },

  creerContrat(
    saisie: CreerContrat,
    opts: RequeteOptions = {},
  ): Promise<ContratVue> {
    return requete(`${BASE}/v1/contrats`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<ContratVue>(r));
  },

  modifierContrat(
    id: string,
    saisie: CreerContrat,
    opts: RequeteOptions = {},
  ): Promise<ContratVue> {
    return requete(`${BASE}/v1/contrats/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<ContratVue>(r));
  },

  supprimerContrat(id: string, opts: RequeteOptions = {}): Promise<void> {
    return requete(`${BASE}/v1/contrats/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<void>(r));
  },

  ecrirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    corps: EcrirePlanning,
    opts: RequeteOptions = {},
  ): Promise<void> {
    const q = simule ? '?simule=true' : '';
    return requete(
      `${BASE}/v1/contrats/${encodeURIComponent(contratId)}/plannings/${encodeURIComponent(mois)}${q}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(corps),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<void>(r));
  },

  lirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    opts: RequeteOptions = {},
  ): Promise<LirePlanningReponse> {
    const q = simule ? '?simule=true' : '';
    return requete(
      `${BASE}/v1/contrats/${encodeURIComponent(contratId)}/plannings/${encodeURIComponent(mois)}${q}`,
      {
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<LirePlanningReponse>(r));
  },

  lireCoutMois(
    foyerId: string,
    mois: string,
    simule: boolean,
    opts: RequeteOptions = {},
  ): Promise<CoutMoisVue> {
    const params = new URLSearchParams({ foyer: foyerId, mois });
    if (simule) params.set('simule', 'true');
    return requete(`${BASE}/v1/couts?${params.toString()}`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<CoutMoisVue>(r));
  },

  lireCoutAnnuel(
    foyerId: string,
    annee: number,
    simule: boolean,
    opts: RequeteOptions = {},
  ): Promise<CoutAnnuelVue> {
    const params = new URLSearchParams({
      foyer: foyerId,
      annee: String(annee),
    });
    if (simule) params.set('simule', 'true');
    return requete(`${BASE}/v1/couts/annuel?${params.toString()}`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<CoutAnnuelVue>(r));
  },

  listerEtablissements(opts: RequeteOptions = {}): Promise<EtablissementVue[]> {
    return requete(`${BASE}/v1/etablissements`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<EtablissementVue[]>(r));
  },

  mettreAJourEtablissement(
    cle: string,
    saisie: MajEtablissement,
    opts: RequeteOptions = {},
  ): Promise<EtablissementVue> {
    return requete(`${BASE}/v1/etablissements/${encodeURIComponent(cle)}`, {
      method: 'PUT',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<EtablissementVue>(r));
  },

  listerAValider(
    foyerId: string,
    opts: RequeteOptions = {},
  ): Promise<NotificationAValider[]> {
    return requete(
      `${BASE}/v1/notifications/a-valider?foyer=${encodeURIComponent(foyerId)}`,
      {
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<NotificationAValider[]>(r));
  },

  validerSemaine(
    contratId: string,
    semaineIso: string,
    opts: RequeteOptions = {},
  ): Promise<ValidationResultat> {
    return requete(
      `${BASE}/v1/notifications/validations/${encodeURIComponent(contratId)}/${encodeURIComponent(semaineIso)}`,
      {
        method: 'POST',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<ValidationResultat>(r));
  },
};
