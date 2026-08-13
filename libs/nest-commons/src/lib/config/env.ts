import { z } from 'zod';

/**
 * Trousse de **validation de l'environnement au démarrage** (`AM-44`, lot 5 des
 * standards). Une seule lecture de `process.env` pour les six applications.
 *
 * ## Pourquoi elle est partagée, et pas six schémas locaux
 *
 * L'énoncé du lot demandait « un schéma zod par app ». Six schémas indépendants
 * auraient été **six miroirs** : `PORT` est lu six fois, `DATABASE_URL` et
 * `NATS_URL` cinq fois, `ASSERTION_IDENTITE_SECRET` cinq fois, et les URL amont
 * (`REFERENTIEL_URL`, `FOYER_URL`, `PLANIFICATION_URL`) dans trois services
 * chacune. Ce n'est pas le *nom* qui est partagé, c'est la **règle de lecture** :
 * ce qui compte comme un entier, ce qui compte comme absent, ce qu'on ose citer
 * dans un message de refus. Recopiée six fois, elle divergerait — c'est
 * exactement ainsi qu'`AN-20` est né (cf. « chaîne vide » ci-dessous).
 *
 * Ce qui reste local à chaque app, c'est la **déclaration** : quelles variables
 * elle lit, avec quel défaut, et quelles règles de production elle impose.
 *
 * ## Les quatre invariants que la trousse impose
 *
 * 1. **Une valeur blanche vaut « absente ».** `GATEWAY_TOKEN=""` doit se lire
 *    comme un jeton non fourni, pas comme le jeton vide. C'est `AN-20` : le
 *    garde-fou de démarrage et le guard lisaient la même variable de deux façons,
 *    si bien que la gateway démarrait en armant son auth sur un jeton vide et
 *    rejetait tout le trafic. La normalisation vit ici, une fois, pour tous.
 * 2. **Une valeur illisible refuse le démarrage, elle ne retombe pas sur un
 *    défaut.** `RATE_LIMIT_MAX=cent` donnait `NaN` : la comparaison
 *    `hits >= NaN` est toujours fausse, donc le rate-limit était **désactivé en
 *    silence**. Un réglage qu'on ne sait pas lire est une panne de configuration,
 *    pas une valeur.
 * 3. **Le refus nomme la variable ; il ne cite sa valeur que si sa forme est
 *    mécanique** (nombre, bascule, URL de service). Un texte libre peut porter un
 *    secret ou une donnée personnelle — le lot 4 a déjà payé ce prix en publiant
 *    une query signée dans un corps d'erreur. Le nom suffit à corriger ; la
 *    valeur, non citable, est décrite par sa longueur.
 * 4. **Un secret entouré d'espaces est refusé, pas rogné.** Sur une valeur qui
 *    sert de **clé** (`ASSERTION_IDENTITE_SECRET`, `DESABONNEMENT_TOKEN_SECRET`),
 *    la normalisation de l'invariant n° 1 serait un changement de clé silencieux :
 *    les liens de désabonnement déjà partis (TTL 30 j) cesseraient de vérifier
 *    sans qu'aucun log ne pointe la cause. Cf. `espacesSignificatifs`.
 *
 * ## Où le refus se produit
 *
 * `lireEnv` est appelée par le `loadConfig()` de chaque app, et `loadConfig()` est
 * la **première instruction** de son `main.ts` : un environnement invalide arrête
 * le processus avant que quoi que ce soit ne soit monté. Il n'y a donc aucun
 * garde-fou à penser à appeler — c'est la lecture elle-même qui garde.
 *
 * (Pour `svc-notifications`, le refus arrive même un peu plus tôt : son
 * `app.module` lit la config dès son évaluation, pour les options du mailer.
 * L'ordre exact n'est pas supposé, il est **observé** — les specs E2E
 * `refus-config.e2e.spec.ts` lancent le bundle réel et vérifient l'arrêt, le code
 * de sortie non nul et le `stderr` qui nomme le champ.)
 *
 * `loadConfig()` est aussi appelée **par requête** dans les guards et les clients
 * (la bascule d'enforce est relue sans redémarrage) : la validation y repasse, sur
 * une vingtaine de champs, ce qui reste sans commune mesure avec un aller-retour
 * HTTP. Aucun cache : les tests posent `process.env` puis relisent, et une
 * mémoïsation rendrait la config non observable.
 */

/** Nom des variables dont la valeur peut être citée dans un message de refus. */
export interface ChampEnv<T> {
  /** Schéma appliqué à la valeur **normalisée** (blanche ⇒ `undefined`). */
  readonly schema: z.ZodType<T>;
  /**
   * Repli de développement, tel qu'écrit à la déclaration. Sert au constat
   * « non posée en production, et son repli vise `localhost` ».
   */
  readonly defaut: unknown;
  /**
   * La valeur **reçue** peut-elle être citée telle quelle dans un refus ?
   * Vrai pour les formes mécaniques (entier, bascule, URL de service), faux pour
   * tout texte libre : secret, e-mail, URL de base de données (mot de passe).
   */
  readonly valeurCitable: boolean;
  /**
   * Les espaces de début et de fin **changent le sens** de cette valeur : c'est le
   * cas d'un secret, qui sert de clé. La normalisation `trim` de la trousse serait
   * alors un **changement de clé silencieux** — un `DESABONNEMENT_TOKEN_SECRET`
   * stocké avec une espace finale signerait, après ce lot, avec une autre clé
   * qu'avant : tous les liens de désabonnement déjà partis (TTL 30 j)
   * cesseraient de vérifier, sans une ligne de log qui pointe la cause.
   *
   * Pour ces champs, une valeur **non blanche mais entourée d'espaces** est donc
   * refusée au démarrage — bruyamment, en nommant la variable. Une valeur
   * entièrement blanche reste « absente » (invariant n° 1, `AN-20`) : là, il n'y a
   * aucune ambiguïté sur l'intention.
   */
  readonly espacesSignificatifs?: boolean;
}

/** Valeurs rendues par `lireEnv` : une entrée par champ déclaré. */
export type ValeursEnv<C extends Record<string, ChampEnv<unknown>>> = {
  readonly [K in keyof C]: C[K] extends ChampEnv<infer T> ? T : never;
};

/**
 * Règle de **production** : une exigence qui ne vaut qu'en `NODE_ENV=production`
 * et qui porte sur plusieurs champs à la fois (« ce jeton est requis, sauf si
 * cette échappatoire est posée »). Les trois `verifierConfigProduction()`
 * homonymes du dépôt — gateway, `svc-foyer`, `svc-notifications` — sont
 * désormais écrites sous cette forme : leur texte est conservé, mais elles ne
 * sont plus des fonctions qu'un `main.ts` peut oublier d'appeler.
 */
export interface RegleProduction<V> {
  /** Étiquette courte, citée dans le refus (ex. « jeton machine (AQ-01) »). */
  readonly nom: string;
  /** Rend le motif du refus, ou `undefined` si la règle est satisfaite. */
  readonly verifier: (valeurs: V) => string | undefined;
}

/** Refus de démarrage : la configuration reçue ne permet pas de servir. */
export class ErreurEnvironnement extends Error {
  constructor(
    readonly app: string,
    readonly constats: readonly string[],
  ) {
    super(
      `${app} — configuration d'environnement refusée (${String(constats.length)} constat(s)) :\n` +
        constats.map((c) => `  - ${c}`).join('\n') +
        "\nLe processus ne démarre pas : corriger l'environnement " +
        '(docker-compose*.yml, .env.server.enc) puis recréer le conteneur.',
    );
    this.name = 'ErreurEnvironnement';
  }
}

/**
 * Normalise une valeur brute d'environnement : `trim`, puis chaîne vide ⇒
 * `undefined` (invariant n° 1). Une variable posée à `''` par un compose
 * (`${VAR:-}`) est donc **absente**, et son défaut s'applique.
 */
function normaliser(brut: string | undefined): string | undefined {
  const taille = brut?.trim();
  return taille !== undefined && taille !== '' ? taille : undefined;
}

/** Construit un champ. Fabrique interne : les apps passent par `champEnv`. */
function champ<T>(
  schema: z.ZodType<T>,
  defaut: unknown,
  valeurCitable: boolean,
  espacesSignificatifs = false,
): ChampEnv<T> {
  return { schema, defaut, valeurCitable, espacesSignificatifs };
}

/** Entier décimal (pas d'hexadécimal, pas de flottant, pas de signe). */
function entierDecimal(min: number, max: number): z.ZodType<number> {
  return z
    .string({ error: 'variable requise mais absente' })
    .regex(/^\d+$/u, { error: 'entier décimal attendu (chiffres uniquement)' })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(min, { error: `valeur ≥ ${String(min)} attendue` })
        .max(max, { error: `valeur ≤ ${String(max)} attendue` }),
    );
}

/**
 * Les formes de variables d'environnement du dépôt. Chaque fabrique fixe **deux**
 * choses que les apps n'ont plus à décider : la règle de lecture, et si la valeur
 * reçue est citable dans un refus.
 */
export const champEnv = {
  /**
   * `NODE_ENV`. Déclaré par la trousse elle-même, jamais par une app : si une
   * seule l'oubliait, **toutes ses règles de production cesseraient de mordre en
   * silence**. Volontairement non énuméré : `staging` ou `qa` restent des
   * valeurs acceptables (seule `production` a un sens ici), refuser une valeur
   * inconnue serait un changement de comportement gratuit.
   */
  environnement: (): ChampEnv<string> =>
    champ(z.string().default('development'), 'development', true),

  /** Port d'écoute TCP. */
  port: (defaut: number): ChampEnv<number> =>
    champ(entierDecimal(1, 65535).default(defaut), defaut, true),

  /** Entier borné (fenêtre de rate-limit, TTL, heure, nombre de relais…). */
  entier: (options: {
    readonly defaut: number;
    readonly min: number;
    readonly max: number;
  }): ChampEnv<number> =>
    champ(
      entierDecimal(options.min, options.max).default(options.defaut),
      options.defaut,
      true,
    ),

  /**
   * URL de base d'un service amont (`http://svc-foyer:3002`).
   *
   * Le protocole est **borné à `http`/`https`** : `z.url()` seul accepte
   * `svc-foyer:3002` — `new URL()` y voit le schéma `svc-foyer:` et le chemin
   * `3002`. C'est la faute de frappe la plus probable sur ces variables (oubli du
   * `http://`), et sans cette borne elle passait la validation pour échouer
   * ensuite à chaque `fetch`.
   */
  urlService: (defaut: string): ChampEnv<string> =>
    champ(
      z
        .url({
          protocol: /^https?$/u,
          error: 'URL http(s) absolue attendue (http://hôte:port)',
        })
        .default(defaut),
      defaut,
      true,
    ),

  /**
   * URL de connexion NATS (`nats://…`). Le schéma d'URL n'est pas `http`, donc
   * `z.url()` doit être borné explicitement.
   */
  urlNats: (defaut: string): ChampEnv<string> =>
    champ(
      z
        .url({
          protocol: /^nats$/u,
          error: 'URL NATS attendue (nats://hôte:port)',
        })
        .default(defaut),
      defaut,
      true,
    ),

  /**
   * URL de connexion Postgres. **Valeur non citable** : elle porte le mot de
   * passe de la base.
   */
  urlPostgres: (defaut: string): ChampEnv<string> =>
    champ(
      z
        .url({
          protocol: /^postgres(ql)?$/u,
          error:
            'URL Postgres attendue (postgres://utilisateur:secret@hôte:port/base)',
        })
        .default(defaut),
      defaut,
      false,
    ),

  /**
   * Bascule d'**activation**, idiome du dépôt : seule la valeur exacte `'1'`
   * active. Tout le reste — absente, vide, `'true'`, `'0'` — laisse inactif. Une
   * bascule qui ouvre un refus (403, 401) ne s'arme que sur un mot exact.
   */
  bascule: (): ChampEnv<boolean> =>
    champ(
      z
        .string()
        .optional()
        .transform((v) => v === '1'),
      undefined,
      true,
    ),

  /**
   * Bascule d'**extinction** : le garde-fou est actif par défaut et seule la
   * valeur exacte `valeurEteignante` le lève. C'est la forme de
   * `NOTIF_EMAIL_DRY_RUN` — on n'écrit pas à une vraie crèche par accident de
   * frappe, il faut l'écrire en clair.
   */
  basculeExtinction: (valeurEteignante: string): ChampEnv<boolean> =>
    champ(
      z
        .string()
        .optional()
        .transform((v) => v !== valeurEteignante),
      undefined,
      true,
    ),

  /**
   * Liste CSV, ordre d'écriture conservé, éléments blancs ignorés. Vide ⇒ `[]`.
   * **Valeur non citable** : ces listes portent des origines ou des adresses.
   */
  liste: (): ChampEnv<readonly string[]> =>
    champ(
      z
        .string()
        .optional()
        .transform((v) =>
          (v ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        ),
      undefined,
      false,
    ),

  /**
   * Allowlist d'e-mails : comme `liste()`, mais **minuscules et dédoublonnée** —
   * une allowlist est un ensemble, et une comparaison d'e-mail est
   * insensible à la casse. **Valeur non citable** (donnée personnelle).
   */
  allowlist: (): ChampEnv<readonly string[]> =>
    champ(
      z
        .string()
        .optional()
        .transform((v) => [
          ...new Set(
            (v ?? '')
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter((s) => s.length > 0),
          ),
        ]),
      undefined,
      false,
    ),

  /** Texte libre avec repli. **Valeur non citable.** */
  texte: (defaut: string): ChampEnv<string> =>
    champ(z.string().default(defaut), defaut, false),

  /**
   * Secret **optionnel** : absent ou blanc ⇒ `undefined`, ce que le code lit
   * comme « non fourni » (mode legacy, auth désactivée…). **Non citable**, et ses
   * **espaces sont significatifs** (cf. `espacesSignificatifs`) : un secret
   * entouré d'espaces est refusé au lieu d'être rogné en silence.
   */
  secret: (): ChampEnv<string | undefined> =>
    champ(z.string().optional(), undefined, false, true),

  /**
   * Secret avec un repli de **développement** assumé (le défaut n'est pas un
   * secret de prod : une règle de production doit le refuser). **Non citable**,
   * espaces significatifs.
   */
  secretAvecRepli: (defaut: string): ChampEnv<string> =>
    champ(z.string().default(defaut), defaut, false, true),
} as const;

/** `NODE_ENV` : toujours lu, jamais déclaré par une app (cf. `environnement`). */
const CHAMPS_AMBIANTS = { NODE_ENV: champEnv.environnement() } as const;

/** Vrai si l'app tourne en production (définition unique du mot). */
export function estProduction(valeurs: { readonly NODE_ENV: string }): boolean {
  return valeurs.NODE_ENV === 'production';
}

/** Repli qui ne peut pas fonctionner ailleurs que sur la machine de dev. */
function replPurementLocal(defaut: unknown): boolean {
  return (
    typeof defaut === 'string' &&
    /(?:\/\/|@)(?:localhost|127\.0\.0\.1)(?::|\/|$)/u.test(defaut)
  );
}

/** Décrit une valeur qu'on ne cite pas : sa longueur, et rien d'autre. */
function decrire(valeur: string, citable: boolean): string {
  return citable
    ? `reçu « ${valeur} »`
    : `reçu une valeur de ${String(valeur.length)} caractère(s)`;
}

/**
 * Lit et **valide** l'environnement d'une application. Rend les valeurs typées,
 * ou lève `ErreurEnvironnement` en nommant **chaque** variable fautive (toutes,
 * pas la première : un opérateur qui corrige une variable à la fois pour
 * découvrir la suivante au redémarrage y passerait la soirée).
 *
 * @param app Nom de l'application, cité dans le refus.
 * @param champs Déclaration des variables lues, clé = nom de la variable.
 * @param options `env` (défaut `process.env`) et règles de production.
 */
export function lireEnv<C extends Record<string, ChampEnv<unknown>>>(
  app: string,
  champs: C,
  options: {
    readonly env?: Record<string, string | undefined>;
    readonly regles?: readonly RegleProduction<
      ValeursEnv<C> & ValeursEnv<typeof CHAMPS_AMBIANTS>
    >[];
  } = {},
): ValeursEnv<C> & ValeursEnv<typeof CHAMPS_AMBIANTS> {
  const env = options.env ?? process.env;
  const declares: Record<string, ChampEnv<unknown>> = {
    ...CHAMPS_AMBIANTS,
    ...champs,
  };

  /** @type {Record<string, unknown>} */
  const valeurs: Record<string, unknown> = {};
  const constats: string[] = [];

  for (const [nom, definition] of Object.entries(declares)) {
    const brut = normaliser(env[nom]);
    // Un secret entouré d'espaces est AMBIGU : la normalisation en changerait la
    // valeur, donc la clé. On refuse au lieu de rogner (cf.
    // `espacesSignificatifs`). Une valeur entièrement blanche reste « absente ».
    if (
      definition.espacesSignificatifs === true &&
      brut !== undefined &&
      env[nom] !== brut
    ) {
      constats.push(
        `${nom} : espaces en début ou en fin de valeur, alors qu'ils comptent ici (secret servant de clé) — les rogner en silence changerait la clé sans que rien ne le dise. Corriger la valeur dans .env.server.enc ou le compose.`,
      );
      continue;
    }
    const lu = definition.schema.safeParse(brut);
    if (lu.success) {
      valeurs[nom] = lu.data;
      continue;
    }
    const motif = lu.error.issues[0]?.message ?? 'valeur invalide';
    constats.push(
      brut === undefined
        ? `${nom} : ${motif}`
        : `${nom} : ${motif} — ${decrire(brut, definition.valeurCitable)}`,
    );
  }

  // Une règle lit des valeurs déjà validées : inutile de la jouer sur une
  // configuration dont un champ n'a pas pu être lu.
  if (constats.length > 0) {
    throw new ErreurEnvironnement(app, constats);
  }

  const typees = valeurs as ValeursEnv<C> & ValeursEnv<typeof CHAMPS_AMBIANTS>;
  if (!estProduction(typees)) {
    return typees;
  }

  // Constat automatique : en production, un repli de développement qui vise
  // `localhost` ne peut joindre personne. Le laisser s'appliquer, c'est
  // démarrer un service qui répond 200 à sa readiness et échoue à chaque
  // requête réelle. Aucune app n'a à y penser : le défaut se déclare, la règle
  // s'en déduit.
  for (const [nom, definition] of Object.entries(declares)) {
    if (
      normaliser(env[nom]) === undefined &&
      replPurementLocal(definition.defaut)
    ) {
      constats.push(
        `${nom} : non posée en production, et son repli de développement vise la machine locale` +
          (definition.valeurCitable
            ? ` (« ${String(definition.defaut)} »)`
            : '') +
          " — l'amont serait injoignable depuis le conteneur.",
      );
    }
  }

  for (const regle of options.regles ?? []) {
    const motif = regle.verifier(typees);
    if (motif !== undefined) {
      constats.push(`${regle.nom} : ${motif}`);
    }
  }

  if (constats.length > 0) {
    throw new ErreurEnvironnement(app, constats);
  }
  return typees;
}
