import type {
  CreerDossierFoyer,
  ModifierFoyer,
  DossierFoyerVue,
  FoyerVue,
  FoyerVersionVue,
  ExportPortabiliteVue,
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
  InboxVue,
  NotificationInApp,
  CreerContrat,
  ContratVue,
  ContratLocal,
  ContratVersionVue,
  ImpactVersion,
  SaisieAvenant,
  SaisieCorrectionVersion,
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
  CorpsEnvoiEtablissement,
  EnvoiEtablissementResultat,
  SemaineBesoins,
  SuiviEnvois,
  GrilleAbcmVue,
  PublierGrille,
  SuiviUaVue,
  EngagementUaVue,
  SessionUaVue,
  DeclarerEngagementUa,
  AjouterSessionUa,
  ModifierSessionUa,
  PeriodesCalendrierVue,
  PeriodeCalendrierVue,
  ExceptionsCalendrierVue,
  ExceptionCalendrierVue,
  ImportCalendrierVue,
  SaisirPeriodeCalendrier,
  PoserExceptionCalendrier,
  RecurrencesCalendrierVue,
  RemplacerRecurrencesCalendrier,
} from '../types/bff';

// Client HTTP du BFF. Base URL configurable via VITE_API_BASE_URL (défaut '/api',
// proxifié vers la gateway :3000 en dev). En-tête Authorization: Bearer ajouté
// seulement si VITE_GATEWAY_TOKEN est défini (auth gateway désactivée sinon).
// Exportés pour le seul point d'appel qui ne passe PAS par ce client : la
// remontée des plantages (`api/signalerErreur.ts`) part d'un chemin de crash, où
// timeout, rejeu et disjoncteur seraient à contre-emploi — mais elle doit viser
// la même base et porter le même jeton, d'où la source unique.
export const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
export const TOKEN = import.meta.env.VITE_GATEWAY_TOKEN;

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

// --- Résilience réseau (GET + écritures idempotentes) ---------------------
//
// Sur une 4G capricieuse, un premier hoquet réseau (fetch → TypeError) ou une
// 502/503/504 passagère de la gateway ne doit pas se solder par une erreur
// visible avec « réessayer » manuel : l'appel est rejouable sans double effet
// (GET, upsert des besoins, validation idempotente par clé unique). On borne à
// 2 nouvelles tentatives avec un backoff court, et on plafonne chaque requête
// par un délai d'expiration pour ne pas rester bloqué indéfiniment. On ne
// rejoue JAMAIS une réponse applicative (4xx) ni une session Access expirée
// (AuthExpiredError) : réessayer n'y changerait rien.

/** Délai d'expiration par requête (AbortSignal.timeout). */
const DELAI_EXPIRATION_MS = 10_000;
/** Backoffs successifs entre tentatives ; sa longueur borne le nombre de rejeux. */
const BACKOFFS_MS: readonly number[] = [500, 1500];

/** 502/503/504 : indisponibilité transitoire de la gateway/amont, rejouable. */
function estStatutRejouable(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * Attente `ms` annulable : rejette immédiatement si le signal est (ou devient)
 * abandonné, pour ne pas rejouer une requête que l'appelant a déjà annulée
 * (démontage du composant, saisie suivante) ou que le timeout a coupée.
 */
function attendre(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const rejeterAbandon = (): void => {
      reject(new DOMException('Requête annulée', 'AbortError'));
    };
    if (signal.aborted) {
      rejeterAbandon();
      return;
    }
    const timer = setTimeout(() => {
      resolve();
    }, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        rejeterAbandon();
      },
      { once: true },
    );
  });
}

/**
 * Variante résiliente de `requete` réservée aux appels idempotents : plafonne la
 * durée (AbortSignal.timeout, combiné au signal de l'appelant) et rejoue les
 * échecs transitoires (TypeError réseau, 502/503/504) avec un backoff borné.
 * Le corps et les en-têtes sont rejoués à l'identique. `estRedirectionAuth`
 * reste géré par `requete` : AuthExpiredError remonte sans rejeu.
 */
function requeteIdempotente(
  url: string,
  init: RequestInit,
  opts: RequeteOptions,
): Promise<Response> {
  const expiration = AbortSignal.timeout(DELAI_EXPIRATION_MS);
  const signal =
    opts.signal !== undefined
      ? AbortSignal.any([opts.signal, expiration])
      : expiration;
  const initAvecSignal: RequestInit = { ...init, signal };

  const rejouer = (backoffs: readonly number[]): Promise<Response> => {
    const [delai, ...reste] = backoffs;
    return attendre(delai ?? 0, signal).then(() => tenter(reste));
  };

  const tenter = (backoffs: readonly number[]): Promise<Response> =>
    requete(url, initAvecSignal).then(
      (res) =>
        backoffs.length > 0 && estStatutRejouable(res.status)
          ? rejouer(backoffs)
          : res,
      (e: unknown) => {
        if (backoffs.length > 0 && e instanceof TypeError)
          return rejouer(backoffs);
        throw e;
      },
    );

  return tenter(BACKOFFS_MS);
}

export const api = {
  /** Identité courante (Cloudflare Access B1) + droits : admin, foyers autorisés. */
  moi(opts: RequeteOptions = {}): Promise<MoiVue> {
    return requeteIdempotente(
      `${BASE}/v1/moi`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<MoiVue>(r));
  },

  /**
   * Mon profil (parent connecté) + mes préférences de notification —
   * `GET /v1/moi/profil`. La ligne parent est résolue **côté serveur** depuis
   * l'identité (le client ne fournit jamais de parentId) : **401** sans identité,
   * **404** si aucune ligne parent ne correspond.
   */
  monProfil(opts: RequeteOptions = {}): Promise<MonProfilVue> {
    return requeteIdempotente(
      `${BASE}/v1/moi/profil`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<MonProfilVue>(r));
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

  /**
   * Mon inbox in-app (parent connecté) — `GET /v1/moi/notifications` : notifications
   * récentes + compteur de non-lus (cloche). Le parent est résolu serveur depuis
   * l'identité ; **401** sans identité, **404** sans ligne parent (la cloche masque
   * alors le compteur).
   */
  listerNotifications(opts: RequeteOptions = {}): Promise<InboxVue> {
    return requeteIdempotente(
      `${BASE}/v1/moi/notifications`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<InboxVue>(r));
  },

  /**
   * Marque une de mes notifications comme lue — `POST /v1/moi/notifications/:id/lu`
   * (renvoie l'état mis à jour). Le parent est résolu serveur (on ne marque que SA
   * notification) ; **404** si l'id est inconnu ou appartient à un autre parent.
   */
  marquerNotificationLue(
    id: string,
    opts: RequeteOptions = {},
  ): Promise<NotificationInApp> {
    return requete(
      `${BASE}/v1/moi/notifications/${encodeURIComponent(id)}/lu`,
      {
        method: 'POST',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<NotificationInApp>(r));
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
    return requeteIdempotente(
      `${BASE}/v1/foyers`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<FoyerVue[]>(r));
  },

  lireFoyer(id: string, opts: RequeteOptions = {}): Promise<DossierFoyerVue> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(id)}`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<DossierFoyerVue>(r));
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

  /**
   * **Efface le foyer entier** — `DELETE /v1/foyers/:id` (204). `requete` et non
   * `requeteIdempotente` : le geste n'est pas rejouable (un second appel répond
   * 404), et un rejeu automatique sur 502/503 transformerait une suppression
   * réussie en « famille introuvable » à l'écran.
   */
  supprimerFoyer(id: string, opts: RequeteOptions = {}): Promise<void> {
    return requete(`${BASE}/v1/foyers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: entetes(false),
      ...(opts.signal ? { signal: opts.signal } : {}),
      // `lire<undefined>` plutôt que `lire<void>` : même comportement sur un 204,
      // sans ajouter une occurrence à la baseline `no-invalid-void-type`.
    }).then((r) => lire<undefined>(r));
  },

  /**
   * Export des données personnelles du foyer — `GET /v1/foyers/:id/export`
   * (portabilité, lot 3). Lecture idempotente, mais **plus lente** que les
   * autres : elle balaie dix-sept tables sur trois services.
   */
  exporterFoyer(
    id: string,
    opts: RequeteOptions = {},
  ): Promise<ExportPortabiliteVue> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(id)}/export`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<ExportPortabiliteVue>(r));
  },

  /** Historique des versions de ressources d'un foyer — `GET /v1/foyers/:id/versions`. */
  versionsFoyer(
    id: string,
    opts: RequeteOptions = {},
  ): Promise<FoyerVersionVue[]> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(id)}/versions`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<FoyerVersionVue[]>(r));
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
    return requeteIdempotente(
      `${BASE}/v1/contrats?foyer=${encodeURIComponent(foyerId)}`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<ContratLocal[]>(r));
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

  /**
   * Crée un **avenant** (SFD 30, US-30-01) : nouvelle version du contrat à date d'effet
   * — `POST /contrats/:id/versions`. 409 si une version existe déjà à cette date, 400 si
   * la date précède le début du contrat (corps d'erreur `[{champ,message}]` via `lire`).
   */
  creerAvenant(
    id: string,
    saisie: SaisieAvenant,
    opts: RequeteOptions = {},
  ): Promise<ContratVue> {
    return requete(`${BASE}/v1/contrats/${encodeURIComponent(id)}/versions`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify(saisie),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<ContratVue>(r));
  },

  /** Historique des versions d'un contrat — `GET /contrats/:id/versions`. */
  listerVersions(
    id: string,
    opts: RequeteOptions = {},
  ): Promise<ContratVersionVue[]> {
    return requeteIdempotente(
      `${BASE}/v1/contrats/${encodeURIComponent(id)}/versions`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<ContratVersionVue[]>(r));
  },

  /**
   * Aperçu d'impact d'une version (SFD 30, US-30-05) — `GET
   * /contrats/:id/versions/:versionId/impact` : les mois recalculés (`moisCouverts`) et
   * ceux déjà communiqués à un établissement (`moisCommuniques`).
   */
  apercuImpact(
    id: string,
    versionId: string,
    opts: RequeteOptions = {},
  ): Promise<ImpactVersion> {
    return requeteIdempotente(
      `${BASE}/v1/contrats/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/impact`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<ImpactVersion>(r));
  },

  /**
   * **Corrige** une version existante (SFD 30, US-30-05) — `PUT
   * /contrats/:id/versions/:versionId` : écrase ses paramètres versionnés sans déplacer
   * sa date d'effet (journalisé côté service). 404 si la version est inconnue.
   */
  corrigerVersion(
    id: string,
    versionId: string,
    saisie: SaisieCorrectionVersion,
    opts: RequeteOptions = {},
  ): Promise<ContratVue> {
    return requete(
      `${BASE}/v1/contrats/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<ContratVue>(r));
  },

  ecrirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    corps: EcrirePlanning,
    opts: RequeteOptions = {},
  ): Promise<void> {
    const q = simule ? '?simule=true' : '';
    // Upsert (remplacement du planning du mois) → rejeu sûr : requête idempotente
    // (même traitement que l'édition hebdomadaire, cf. ecrireSemaineBesoins).
    return requeteIdempotente(
      `${BASE}/v1/contrats/${encodeURIComponent(contratId)}/plannings/${encodeURIComponent(mois)}${q}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(corps),
      },
      opts,
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
    // Upsert (fusion read-modify-write côté serveur) → rejeu sûr : requête idempotente.
    return requeteIdempotente(
      `${BASE}/v1/contrats/${encodeURIComponent(contratId)}/plannings/semaine/${encodeURIComponent(semaineIso)}${q}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(besoins),
      },
      opts,
    ).then((r) => lire<void>(r));
  },

  lirePlanning(
    contratId: string,
    mois: string,
    simule: boolean,
    opts: RequeteOptions = {},
  ): Promise<LirePlanningReponse> {
    const q = simule ? '?simule=true' : '';
    return requeteIdempotente(
      `${BASE}/v1/contrats/${encodeURIComponent(contratId)}/plannings/${encodeURIComponent(mois)}${q}`,
      { headers: entetes(false) },
      opts,
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
    return requeteIdempotente(
      `${BASE}/v1/couts?${params.toString()}`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<CoutMoisVue>(r));
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
    return requeteIdempotente(
      `${BASE}/v1/couts/annuel?${params.toString()}`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<CoutAnnuelVue>(r));
  },

  // ---- Unités associatives (SFD 40) -----------------------------------------
  //
  // **Martha ne réserve rien** : les créneaux se prennent sur le site travaux de
  // l'association (RM-40-01). Ces appels tiennent le compte de ce qui a été pris
  // et de ce qui a été fait.

  /** Suivi du foyer — `GET /v1/unites-associatives?foyer=` (compteurs + sessions). */
  lireSuiviUnitesAssociatives(
    foyerId: string,
    opts: RequeteOptions = {},
  ): Promise<SuiviUaVue> {
    return requeteIdempotente(
      `${BASE}/v1/unites-associatives?foyer=${encodeURIComponent(foyerId)}`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<SuiviUaVue>(r));
  },

  /** Déclare l'engagement de la période — `POST /v1/unites-associatives?foyer=`. */
  declarerEngagementUa(
    foyerId: string,
    saisie: DeclarerEngagementUa,
    opts: RequeteOptions = {},
  ): Promise<EngagementUaVue> {
    return requete(
      `${BASE}/v1/unites-associatives?foyer=${encodeURIComponent(foyerId)}`,
      {
        method: 'POST',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<EngagementUaVue>(r));
  },

  /** Note un créneau déjà réservé — `POST /v1/unites-associatives/sessions?foyer=`. */
  ajouterSessionUa(
    foyerId: string,
    saisie: AjouterSessionUa,
    opts: RequeteOptions = {},
  ): Promise<SessionUaVue> {
    return requete(
      `${BASE}/v1/unites-associatives/sessions?foyer=${encodeURIComponent(foyerId)}`,
      {
        method: 'POST',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<SessionUaVue>(r));
  },

  /** Marque une session réalisée / annulée — `PUT …/sessions/:id?foyer=`. */
  modifierSessionUa(
    foyerId: string,
    sessionId: string,
    saisie: ModifierSessionUa,
    opts: RequeteOptions = {},
  ): Promise<SessionUaVue> {
    return requete(
      `${BASE}/v1/unites-associatives/sessions/${encodeURIComponent(sessionId)}` +
        `?foyer=${encodeURIComponent(foyerId)}`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<SessionUaVue>(r));
  },

  /**
   * Supprime une session saisie par erreur — `DELETE …/sessions/:id?foyer=` (204).
   * `requete` et non `requeteIdempotente` : un second appel répond 404, et un
   * rejeu automatique transformerait une suppression réussie en « introuvable ».
   */
  supprimerSessionUa(
    foyerId: string,
    sessionId: string,
    opts: RequeteOptions = {},
  ): Promise<void> {
    return requete(
      `${BASE}/v1/unites-associatives/sessions/${encodeURIComponent(sessionId)}` +
        `?foyer=${encodeURIComponent(foyerId)}`,
      {
        method: 'DELETE',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<undefined>(r));
  },

  /** Établissements (entité libre) d'un foyer — `GET /v1/foyers/:foyerId/etablissements`. */
  listerEtablissements(
    foyerId: string,
    opts: RequeteOptions = {},
  ): Promise<EtablissementFoyerVue[]> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<EtablissementFoyerVue[]>(r));
  },

  /**
   * Calendrier d'ouverture d'un établissement (SFD 31).
   *
   * Les quatre lectures ci-dessous rendent les **couches brutes** (récurrences,
   * périodes, exceptions), pas le calendrier résolu : l'écran de saisie montre ce
   * que le parent a posé, pas ce que le domaine en déduit. La résolution
   * (`GET …/calendrier`) est le contrat gelé que consommera le plan 33 — l'écran
   * de saisie n'a rien à y faire.
   */
  lirePeriodesCalendrier(
    foyerId: string,
    etablissementId: string,
    opts: RequeteOptions = {},
  ): Promise<PeriodesCalendrierVue> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/periodes`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<PeriodesCalendrierVue>(r));
  },

  lireExceptionsCalendrier(
    foyerId: string,
    etablissementId: string,
    opts: RequeteOptions = {},
  ): Promise<ExceptionsCalendrierVue> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/exceptions`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<ExceptionsCalendrierVue>(r));
  },

  /**
   * Importe une année scolaire — `POST …/calendrier/import`.
   *
   * **Pas** `requeteIdempotente` : le rejeu automatique d'une écriture doublerait
   * l'action sur un réseau capricieux. L'import est idempotent en base, mais
   * c'est au serveur de le garantir, pas au client de le supposer.
   */
  importerCalendrier(
    foyerId: string,
    etablissementId: string,
    anneeScolaire: string,
    opts: RequeteOptions = {},
  ): Promise<ImportCalendrierVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/import`,
      {
        method: 'POST',
        headers: entetes(true),
        body: JSON.stringify({ anneeScolaire }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<ImportCalendrierVue>(r));
  },

  /** Semaine type par régime — `GET …/calendrier/recurrences`. */
  lireRecurrencesCalendrier(
    foyerId: string,
    etablissementId: string,
    opts: RequeteOptions = {},
  ): Promise<RecurrencesCalendrierVue> {
    return requeteIdempotente(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/recurrences`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<RecurrencesCalendrierVue>(r));
  },

  /**
   * Remplace la semaine type d'un régime — `PUT …/calendrier/recurrences`.
   *
   * « Remplace » au sens append-only : le service clôt les lignes du régime et en
   * ouvre de nouvelles. La semaine d'avant reste lisible à un instant antérieur.
   */
  remplacerRecurrencesCalendrier(
    foyerId: string,
    etablissementId: string,
    saisie: RemplacerRecurrencesCalendrier,
    opts: RequeteOptions = {},
  ): Promise<RecurrencesCalendrierVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/recurrences`,
      {
        method: 'PUT',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<RecurrencesCalendrierVue>(r));
  },

  /** Ouvre une période saisie à la main — `POST …/calendrier/periodes` (201). */
  saisirPeriodeCalendrier(
    foyerId: string,
    etablissementId: string,
    saisie: SaisirPeriodeCalendrier,
    opts: RequeteOptions = {},
  ): Promise<PeriodeCalendrierVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/periodes`,
      {
        method: 'POST',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<PeriodeCalendrierVue>(r));
  },

  /** Pose une exception ponctuelle — `POST …/calendrier/exceptions` (201). */
  poserExceptionCalendrier(
    foyerId: string,
    etablissementId: string,
    saisie: PoserExceptionCalendrier,
    opts: RequeteOptions = {},
  ): Promise<ExceptionCalendrierVue> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/exceptions`,
      {
        method: 'POST',
        headers: entetes(true),
        body: JSON.stringify(saisie),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then((r) => lire<ExceptionCalendrierVue>(r));
  },

  /**
   * Clôt une exception — `DELETE …/calendrier/exceptions/:id`.
   *
   * « Supprimer » est une **clôture** : la ligne reste lisible à un instant de
   * connaissance antérieur. L'écran dit donc « retirer », jamais « supprimer
   * définitivement » — le mot compte, il décrit ce qui se passe.
   */
  cloreExceptionCalendrier(
    foyerId: string,
    etablissementId: string,
    exceptionId: string,
    opts: RequeteOptions = {},
  ): Promise<void> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/exceptions/${encodeURIComponent(exceptionId)}`,
      {
        method: 'DELETE',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then(() => undefined);
  },

  /** Clôt une période — `DELETE …/calendrier/periodes/:id` (clôture, pas effacement). */
  clorePeriodeCalendrier(
    foyerId: string,
    etablissementId: string,
    periodeId: string,
    opts: RequeteOptions = {},
  ): Promise<void> {
    return requete(
      `${BASE}/v1/foyers/${encodeURIComponent(foyerId)}/etablissements/${encodeURIComponent(etablissementId)}/calendrier/periodes/${encodeURIComponent(periodeId)}`,
      {
        method: 'DELETE',
        headers: entetes(false),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    ).then(() => undefined);
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
    return requeteIdempotente(
      `${BASE}/v1/notifications/a-valider?foyer=${encodeURIComponent(foyerId)}`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<NotificationAValider[]>(r));
  },

  lireSemaineBesoins(
    foyerId: string,
    semaineIso: string,
    opts: RequeteOptions = {},
  ): Promise<SemaineBesoins> {
    return requeteIdempotente(
      `${BASE}/v1/notifications/semaine/${encodeURIComponent(foyerId)}/${encodeURIComponent(semaineIso)}/besoins`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<SemaineBesoins>(r));
  },

  validerSemaine(
    contratId: string,
    semaineIso: string,
    opts: RequeteOptions = {},
  ): Promise<ValidationResultat> {
    // Idempotente par clé unique (svc-notifications) → rejeu sûr d'un POST.
    return requeteIdempotente(
      `${BASE}/v1/notifications/validations/${encodeURIComponent(contratId)}/${encodeURIComponent(semaineIso)}`,
      {
        method: 'POST',
        headers: entetes(false),
      },
      opts,
    ).then((r) => lire<ValidationResultat>(r));
  },

  lireBrouillonEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
    opts: RequeteOptions = {},
  ): Promise<BrouillonEtablissement> {
    return requeteIdempotente(
      `${BASE}/v1/notifications/semaine/${encodeURIComponent(foyerId)}/${encodeURIComponent(semaineIso)}/etablissements/${encodeURIComponent(etablissementId)}/brouillon`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<BrouillonEtablissement>(r));
  },

  /**
   * Suivi **persistant** des envois d'une semaine (B1, lecture seule) —
   * `GET /v1/notifications/semaine/:foyerId/:semaineIso/envois`. Alimente le bloc
   * « Suivi des envois » de l'encart de validation.
   */
  lireSuiviEnvois(
    foyerId: string,
    semaineIso: string,
    opts: RequeteOptions = {},
  ): Promise<SuiviEnvois> {
    return requeteIdempotente(
      `${BASE}/v1/notifications/semaine/${encodeURIComponent(foyerId)}/${encodeURIComponent(semaineIso)}/envois`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<SuiviEnvois>(r));
  },

  /**
   * Grilles ABCM publiées (catalogue global) — `GET /v1/referentiel/grilles`.
   * Écran « Tarifs » (SFD 30, US-30-02) : le front regroupe les lignes par période.
   */
  listerGrilles(opts: RequeteOptions = {}): Promise<GrilleAbcmVue[]> {
    return requeteIdempotente(
      `${BASE}/v1/referentiel/grilles`,
      { headers: entetes(false) },
      opts,
    ).then((r) => lire<GrilleAbcmVue[]>(r));
  },

  /**
   * Publie une grille ABCM complète (montants EUROS) — `POST /v1/referentiel/grilles`
   * (201 = lignes créées). **409** si la période chevauche une grille existante :
   * l'appelant lit `ApiError.status === 409` (corps `{ code: 'PERIODE_CHEVAUCHANTE' }`)
   * pour afficher un message clair. Non idempotente (publication) → pas de rejeu.
   */
  publierGrille(
    corps: PublierGrille,
    opts: RequeteOptions = {},
  ): Promise<GrilleAbcmVue[]> {
    return requete(`${BASE}/v1/referentiel/grilles`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify(corps),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<GrilleAbcmVue[]>(r));
  },

  envoyerRecapEtablissement(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
    // Objet + corps édités par le parent (L9). Omis ⇒ le service régénère le corps
    // depuis le delta (rétro-compat L8). Fournis ⇒ son texte exact part (les deux
    // ensemble ou aucun, cf. `CorpsEnvoiEtablissement`).
    corps?: CorpsEnvoiEtablissement,
    opts: RequeteOptions = {},
  ): Promise<EnvoiEtablissementResultat> {
    return requete(`${BASE}/v1/notifications/envois/etablissement`, {
      method: 'POST',
      headers: entetes(true),
      body: JSON.stringify({
        foyerId,
        semaineIso,
        etablissementId,
        ...(corps ? { sujet: corps.sujet, corps: corps.corps } : {}),
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }).then((r) => lire<EnvoiEtablissementResultat>(r));
  },
};
