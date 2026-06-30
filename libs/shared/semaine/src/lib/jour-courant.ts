/**
 * Jour calendaire **courant** (`YYYY-MM-DD`) normalisé en fuseau **Europe/Paris**.
 *
 * Un instant (`Date`) est un point sur la ligne du temps ; la *date du jour* qu'il
 * représente dépend du fuseau. Côté serveur (UTC) comme côté navigateur (fuseau du
 * poste), lire « aujourd'hui » avec l'horloge locale décalerait le jour autour de
 * minuit. Ce module fixe la convention métier — **Europe/Paris** — comme le fait le
 * scheduler hebdomadaire du mardi (`svc-notifications`, `scheduler.hebdo.ts`).
 *
 * L'instant est **passé en argument** (`now`) : la fonction est pure et
 * déterministe, donc testable sans figer l'horloge (DST mars/octobre, minuit
 * Paris ≠ minuit UTC, bord d'année). Aucune I/O, aucune lecture d'horloge réelle.
 */

const FORMAT_PARIS = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Date calendaire `YYYY-MM-DD` de l'instant `now`, lue dans le fuseau Europe/Paris.
 *
 * On assemble depuis `formatToParts` (plutôt que `.format`) pour ne dépendre ni de
 * l'ordre ni des séparateurs émis par l'implémentation ICU.
 */
export function jourCourantParis(now: Date): string {
  let annee = '';
  let mois = '';
  let jour = '';
  for (const p of FORMAT_PARIS.formatToParts(now)) {
    if (p.type === 'year') {
      annee = p.value;
    } else if (p.type === 'month') {
      mois = p.value;
    } else if (p.type === 'day') {
      jour = p.value;
    }
  }
  return `${annee}-${mois}-${jour}`;
}
