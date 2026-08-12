/**
 * Lien vers la page publique d'information sur les données (« Informations sur vos
 * données »), inséré en pied des courriels sortants.
 *
 * Le **chemin** est écrit ici une seule fois : deux appelants l'insèrent (le scheduler
 * du récap parent, le service d'envoi à l'établissement), et une page déplacée ne doit
 * pas laisser un mail pointer dans le vide. Le **domaine**, lui, n'est jamais en dur :
 * il vient de la base publique du front (`NOTIF_APP_URL`, cf. `config.ts` →
 * `OptionsScheduler.appUrl`), exactement comme le lien « valider » et le lien de
 * désabonnement. Le garde-fou `verifierConfigProduction` couvre donc ce lien aussi.
 */

/** Chemin de la page d'information, côté front (accessible sans authentification). */
export const CHEMIN_MENTIONS = '/mentions';

/** Compose le lien absolu à partir de la base publique du front. */
export function construireLienMentions(appUrl: string): string {
  return `${appUrl}${CHEMIN_MENTIONS}`;
}
