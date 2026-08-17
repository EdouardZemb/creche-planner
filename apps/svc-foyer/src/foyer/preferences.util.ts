import {
  foyerIdSchema,
  parentIdSchema,
  type Canal,
  type PreferencesNotifModifieesPayload,
  type TypeNotification,
} from '@creche-planner/contracts-foyer';
import type { PreferenceNotificationRow } from '../database/schema.js';

/**
 * Fonctions **pures** des préférences de notification, partagées entre
 * `FoyerService` (écran « Mon profil ») et `DesabonnementService` (lien one-click
 * RFC 8058, PR5). Extraites pour éviter la duplication de la matrice par défaut,
 * de l'invariant « ≥ 1 canal actif » et du mapping de l'événement d'état complet.
 */

/**
 * Projection **effective** d'une préférence : la combinaison de la matrice (§5.1)
 * renseignée par sa ligne stockée. `consentementAt`/`desabonneAt` sont des ISO (ou
 * `null` tant que non posés) ; les deux à `null` avec `actif: false` signale une
 * combinaison **sans ligne** — aucun consentement enregistré.
 */
export interface PreferenceVue {
  readonly typeNotification: TypeNotification;
  readonly canal: Canal;
  readonly actif: boolean;
  readonly consentementAt: string | null;
  readonly desabonneAt: string | null;
}

/**
 * **Matrice des préférences** exposées au parent (§5.1). Seule la validation hebdo
 * est configurable ; le récap au service n'est pas désabonnable côté parent (il part
 * quoi qu'il arrive) et n'a donc pas d'entrée ici.
 *
 * Cette matrice est **matérialisée en base à l'inscription** du parent
 * (`materialiserConsentementParDefaut`), avec `source_dernier = 'DEFAUT'` : le
 * consentement initial est celui du défaut applicatif, pas un geste de l'utilisateur,
 * et la colonne le dit. Elle n'est plus un **repli de lecture** : une combinaison
 * absente de la base ne vaut plus consentement (`AM-57`).
 */
export const DEFAUTS_PREFERENCES: readonly {
  readonly typeNotification: TypeNotification;
  readonly canal: Canal;
  readonly actif: boolean;
}[] = [
  { typeNotification: 'VALIDATION_HEBDO', canal: 'EMAIL', actif: true },
  { typeNotification: 'VALIDATION_HEBDO', canal: 'IN_APP', actif: true },
];

/**
 * Types **de service** (transactionnels) : au moins un canal doit rester actif —
 * on ne peut jamais se rendre injoignable pour une notification de service (§5.3).
 */
export const TYPES_SERVICE: ReadonlySet<TypeNotification> = new Set([
  'VALIDATION_HEBDO',
]);

/** Clé de fusion défaut/stocké d'une préférence : `type|canal`. */
function clePreference(typeNotification: string, canal: string): string {
  return `${typeNotification}|${canal}`;
}

/**
 * État **effectif** des préférences d'un parent : chaque combinaison de la matrice
 * (§5.1) est émise, renseignée par sa ligne stockée quand elle existe, puis toute
 * ligne stockée hors matrice (extensibilité). Ordre stable (matrice d'abord) pour
 * des tests déterministes.
 *
 * ⚠️ **Une combinaison sans ligne vaut `actif: false`** (`AM-57`). Elle valait
 * `actif: true` jusqu'au lot 2 du chantier « Le coût ne ment plus », et c'était le
 * défaut : le consentement se **déduisait d'une absence**, si bien que supprimer une
 * ligne `actif = false` — purge de rétention, effacement RGPD, geste manuel —
 * **réabonnait** le parent, sans trace et sans que rien ne le signale. Or c'est
 * exactement la population qu'une borne de rétention viserait (T3bis, doc 37).
 *
 * Le consentement est désormais **écrit** : la matrice est matérialisée à
 * l'inscription (`materialiserConsentementParDefaut`) et le back-fill `0008` l'a posée
 * pour les parents antérieurs. Une ligne manquante ne signifie donc plus « jamais
 * touché » mais « aucun consentement enregistré » — et un consentement qu'on ne peut
 * pas produire ne s'invente pas.
 */
export function preferencesEffectives(
  rows: PreferenceNotificationRow[],
): PreferenceVue[] {
  const parCle = new Map(
    rows.map((r) => [clePreference(r.typeNotification, r.canal), r]),
  );
  const vus = new Set<string>();
  const resultat: PreferenceVue[] = [];
  const pousser = (typeNotification: TypeNotification, canal: Canal): void => {
    const cle = clePreference(typeNotification, canal);
    if (vus.has(cle)) {
      return;
    }
    vus.add(cle);
    const row = parCle.get(cle);
    resultat.push({
      typeNotification,
      canal,
      // Pas de ligne ⇒ pas de consentement enregistré ⇒ `false`. Jamais un repli
      // sur la valeur d'inscription : c'est elle qui rendait la suppression d'une
      // ligne « désabonné » indistinguable d'un ré-abonnement (`AM-57`).
      actif: row ? row.actif : false,
      consentementAt: row?.consentementAt?.toISOString() ?? null,
      desabonneAt: row?.desabonneAt?.toISOString() ?? null,
    });
  };
  for (const d of DEFAUTS_PREFERENCES) {
    pousser(d.typeNotification, d.canal);
  }
  for (const r of rows) {
    pousser(r.typeNotification as TypeNotification, r.canal as Canal);
  }
  return resultat;
}

/**
 * Lignes de consentement **par défaut** d'un parent qui s'inscrit : la matrice §5.1,
 * `actif` à sa valeur d'inscription, `consentement_at` posé à l'instant de
 * l'inscription et `source_dernier = 'DEFAUT'` — le consentement vient du défaut
 * applicatif, pas d'un geste, et la colonne permet de les distinguer pour toujours.
 *
 * À insérer **en `onConflictDoNothing`**, dans la transaction qui crée le parent : sur
 * une **réactivation** (parent inactif réadmis dans le foyer), les lignes existent déjà
 * et peuvent porter un désabonnement — les écraser ré-abonnerait quelqu'un qui s'était
 * explicitement retiré, précisément le défaut que ce lot ferme.
 */
export function materialiserConsentementParDefaut(
  parentId: string,
  maintenant: Date,
): {
  parentId: string;
  typeNotification: TypeNotification;
  canal: Canal;
  actif: boolean;
  consentementAt: Date | null;
  desabonneAt: null;
  sourceDernier: string;
  updatedAt: Date;
}[] {
  return DEFAUTS_PREFERENCES.map((d) => ({
    parentId,
    typeNotification: d.typeNotification,
    canal: d.canal,
    actif: d.actif,
    consentementAt: d.actif ? maintenant : null,
    desabonneAt: null,
    sourceDernier: 'DEFAUT',
    updatedAt: maintenant,
  }));
}

/**
 * Invariant §5.3 : pour chaque type **de service** présent, au moins un canal doit
 * rester actif. Renvoie le **premier type fautif** (aucun canal actif) ou `null`
 * si l'invariant est respecté. L'appelant décide du code d'erreur (400 côté écran,
 * 409 côté lien de désabonnement one-click).
 */
export function typeServiceInjoignable(
  effectives: readonly PreferenceVue[],
): TypeNotification | null {
  for (const type of TYPES_SERVICE) {
    const canaux = effectives.filter((p) => p.typeNotification === type);
    if (canaux.length > 0 && !canaux.some((p) => p.actif)) {
      return type;
    }
  }
  return null;
}

/**
 * Construit le **payload d'état complet** de `foyer.PreferencesNotifModifiees.v1`
 * (les consommateurs projettent sans relire la source). Les timestamps optionnels
 * ne sont posés que s'ils existent (`exactOptionalPropertyTypes`).
 */
export function payloadPreferences(
  foyerId: string,
  parentId: string,
  effectives: readonly PreferenceVue[],
): PreferencesNotifModifieesPayload {
  return {
    foyerId: foyerIdSchema.parse(foyerId),
    parentId: parentIdSchema.parse(parentId),
    preferences: effectives.map((p) => ({
      typeNotification: p.typeNotification,
      canal: p.canal,
      actif: p.actif,
      ...(p.consentementAt ? { consentementAt: p.consentementAt } : {}),
      ...(p.desabonneAt ? { desabonneAt: p.desabonneAt } : {}),
    })),
  };
}
