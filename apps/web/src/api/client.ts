import type {
  CreerDossierFoyer,
  ModifierFoyer,
  DossierFoyerVue,
  FoyerVue,
  EnfantVue,
  ParentVue,
  CreerEnfant,
  ModifierEnfant,
  CreerParent,
  ModifierParent,
  MoiVue,
  MonProfilVue,
  PreferenceVue,
  MajPreferences,
  CreerContrat,
  ContratVue,
  ContratLocal,
  EcrirePlanning,
  EcrireSemaineBesoins,
  LirePlanningReponse,
  CoutMoisVue,
  CoutAnnuelVue,
  EtablissementFoyerVue,
  CreerEtablissement,
  ModifierEtablissement,
  NotificationAValider,
  ValidationResultat,
  BrouillonEtablissement,
  EnvoiEtablissementResultat,
  SemaineBesoins,
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
  /** Identité courante (Cloudflare Access B1) + droits : admin, foyers autorisés. */
  moi(opts: RequeteOptions = {}): Promise<MoiVue> {
    return requete(`${BASE}/v1/moi`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<MoiVue>(r));
  },

  /**
   * Mon profil (parent connecté) + mes préférences de notification —
   * `GET /v1/moi/profil`. La ligne parent est résolue **côté serveur** depuis
   * l'identité (le client ne fournit jamais de parentId) : **401** sans identité,
   * **404** si aucune ligne parent ne correspond.
   */
  monProfil(opts: RequeteOptions = {}): Promise<MonProfilVue> {
    return requete(`${BASE}/v1/moi/profil`, {
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<MonProfilVue>(r));
  },

  /**
   * Met à jour mes préférences de notification — `PUT /v1/moi/preferences`
   * (renvoie l'état effectif). Le parent visé est résolu serveur depuis
   * l'identité (on ne modifie que SA ligne) ; **400** si la combinaison coupe
   * tous les canaux d'un type de service (invariant ≥ 1 canal actif).
   */
  majPreferences(
    saisie: MajPreferences,
    opts: RequeteOptions = {},
  ): Promise<PreferenceVue[]> {
    return requete(`${BASE}/v1/moi/preferences`, {
      method: 'PUT',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<PreferenceVue[]>(r));
  },

  /**
   * Désabonnement one-click (RFC 8058) — `POST /v1/desabonnement?token=…`. Endpoint
   * **public** (aucune session requise) : le jeton signé opaque est le seul
   * paramètre. **204** succès ; l'appelant distingue **409** (dernier canal d'un
   * type de service, non coupable) et **400** (lien invalide/expiré/déjà utilisé)
   * via `ApiError.status`.
   */
  desabonner(token: string, opts: RequeteOptions = {}): Promise<void> {
    return requete(
      `${BASE}/v1/desabonnement?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<void>(r));
  },

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

  /** Édite les scalaires d'un foyer — `PUT /v1/foyers/:id` (parent du foyer ; renvoie la vue). */
  modifierFoyer(
    id: string,
    saisie: ModifierFoyer,
    opts: RequeteOptions = {},
  ): Promise<FoyerVue> {
    return requete(`${BASE}/v1/foyers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<FoyerVue>(r));
  },

  /** Rattache un parent au foyer — `POST /v1/foyers/:id/parents` (201 ; **409** si e-mail/principal en conflit). */
  ajouterParent(
    foyerId: string,
    saisie: CreerParent,
    opts: RequeteOptions = {},
  ): Promise<ParentVue> {
    return requete(`${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/parents`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<ParentVue>(r));
  },

  /** Édite un parent (champs fournis) — `PUT /v1/foyers/:id/parents/:parentId` (**409** possible). */
  modifierParent(
    foyerId: string,
    parentId: string,
    saisie: ModifierParent,
    opts: RequeteOptions = {},
  ): Promise<ParentVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/parents/${encodeURIComponent(parentId)}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<ParentVue>(r));
  },

  /** Retire un parent (soft-delete côté service) — `DELETE /v1/foyers/:id/parents/:parentId` (204). */
  retirerParent(
    foyerId: string,
    parentId: string,
    opts: RequeteOptions = {},
  ): Promise<void> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/parents/${encodeURIComponent(parentId)}`,
      {
        method: 'DELETE',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<void>(r));
  },

  /** Rattache un enfant au foyer — `POST /v1/foyers/:id/enfants` (201). */
  ajouterEnfant(
    foyerId: string,
    saisie: CreerEnfant,
    opts: RequeteOptions = {},
  ): Promise<EnfantVue> {
    return requete(`${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/enfants`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<EnfantVue>(r));
  },

  /**
   * Édite un enfant (prénom/date) — `PUT /v1/foyers/:id/enfants/:enfantId`.
   * Renommer un enfant n'affecte pas les contrats existants (couplage par prénom).
   */
  modifierEnfant(
    foyerId: string,
    enfantId: string,
    saisie: ModifierEnfant,
    opts: RequeteOptions = {},
  ): Promise<EnfantVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/enfants/${encodeURIComponent(enfantId)}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<EnfantVue>(r));
  },

  /** Retire un enfant (hard delete côté service) — `DELETE /v1/foyers/:id/enfants/:enfantId` (204). */
  retirerEnfant(
    foyerId: string,
    enfantId: string,
    opts: RequeteOptions = {},
  ): Promise<void> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/enfants/${encodeURIComponent(enfantId)}`,
      {
        method: 'DELETE',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<void>(r));
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

  ecrireSemaineBesoins(
    contratId: string,
    semaineIso: string,
    besoins: EcrireSemaineBesoins,
    simule = false,
    opts: RequeteOptions = {},
  ): Promise<void> {
    const q = simule ? '?simule=true' : '';
    return requete(
      `${BASE}/v1/contrats/${encodeURIComponent(contratId)}/plannings/semaine/${encodeURIComponent(semaineIso)}${q}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(besoins),
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

  /** Établissements (entité libre) d'un foyer — `GET /v1/foyers/:foyerId/etablissements`. */
  listerEtablissements(
    foyerId: string,
    opts: RequeteOptions = {},
  ): Promise<EtablissementFoyerVue[]> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements`,
      {
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<EtablissementFoyerVue[]>(r));
  },

  /** Crée un établissement dans le foyer — `POST /v1/foyers/:foyerId/etablissements` (201). */
  creerEtablissement(
    foyerId: string,
    saisie: CreerEtablissement,
    opts: RequeteOptions = {},
  ): Promise<EtablissementFoyerVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements`,
      {
        method: 'POST',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<EtablissementFoyerVue>(r));
  },

  /** Modifie un établissement du foyer — `PUT /v1/foyers/:foyerId/etablissements/:id`. */
  modifierEtablissement(
    foyerId: string,
    id: string,
    saisie: ModifierEtablissement,
    opts: RequeteOptions = {},
  ): Promise<EtablissementFoyerVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<EtablissementFoyerVue>(r));
  },

  /**
   * Supprime un établissement du foyer — `DELETE /v1/foyers/:foyerId/etablissements/:id`
   * (204 ; **409** si des contrats y sont rattachés → l'appelant affiche l'erreur).
   */
  supprimerEtablissement(
    foyerId: string,
    id: string,
    opts: RequeteOptions = {},
  ): Promise<void> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<void>(r));
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

  lireSemaineBesoins(
    foyerId: string,
    semaineIso: string,
    opts: RequeteOptions = {},
  ): Promise<SemaineBesoins> {
    return requete(
      `${BASE}/v1/notifications/semaine/${encodeURIComponent(foyerId)}/${encodeURIComponent(semaineIso)}/besoins`,
      {
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<SemaineBesoins>(r));
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

  lireBrouillonEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
    opts: RequeteOptions = {},
  ): Promise<BrouillonEtablissement> {
    return requete(
      `${BASE}/v1/notifications/semaine/${encodeURIComponent(foyerId)}/${encodeURIComponent(semaineIso)}/etablissements/${encodeURIComponent(etablissementId)}/brouillon`,
      {
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<BrouillonEtablissement>(r));
  },

  envoyerRecapEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
    opts: RequeteOptions = {},
  ): Promise<EnvoiEtablissementResultat> {
    return requete(`${BASE}/v1/notifications/envois/etablissement`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify({ foyerId, semaineIso, etablissementId }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<EnvoiEtablissementResultat>(r));
  },
};
