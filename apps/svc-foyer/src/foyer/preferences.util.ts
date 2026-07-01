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
 * Projection **effective** d'une préférence : le défaut applicatif (§5.1) fusionné
 * avec l'éventuel choix explicite stocké. `consentementAt`/`desabonneAt` sont des
 * ISO (ou `null` tant que non posés).
 */
export interface PreferenceVue {
  readonly typeNotification: TypeNotification;
  readonly canal: Canal;
  readonly actif: boolean;
  readonly consentementAt: string | null;
  readonly desabonneAt: string | null;
}

/**
 * **Matrice par défaut** des préférences exposées au parent (§5.1). Seule la
 * validation hebdo est configurable ; le récap au service n'est pas désabonnable
 * côté parent (il part quoi qu'il arrive) et n'a donc pas de défaut ici. Une
 * combinaison absente de la base retombe sur `actif` par défaut.
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
 * Fusionne la **matrice par défaut** (§5.1) avec les lignes stockées : chaque
 * défaut est émis (surchargé par sa ligne si elle existe), puis toute ligne
 * stockée hors défaut (extensibilité). Ordre stable (défauts d'abord) pour des
 * tests déterministes.
 */
export function fusionnerDefauts(
  rows: PreferenceNotificationRow[],
): PreferenceVue[] {
  const parCle = new Map(
    rows.map((r) => [clePreference(r.typeNotification, r.canal), r]),
  );
  const vus = new Set<string>();
  const resultat: PreferenceVue[] = [];
  const pousser = (
    typeNotification: TypeNotification,
    canal: Canal,
    actifDefaut: boolean,
  ): void => {
    const cle = clePreference(typeNotification, canal);
    if (vus.has(cle)) {
      return;
    }
    vus.add(cle);
    const row = parCle.get(cle);
    resultat.push({
      typeNotification,
      canal,
      actif: row ? row.actif : actifDefaut,
      consentementAt: row?.consentementAt?.toISOString() ?? null,
      desabonneAt: row?.desabonneAt?.toISOString() ?? null,
    });
  };
  for (const d of DEFAUTS_PREFERENCES) {
    pousser(d.typeNotification, d.canal, d.actif);
  }
  for (const r of rows) {
    pousser(r.typeNotification as TypeNotification, r.canal as Canal, r.actif);
  }
  return resultat;
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
