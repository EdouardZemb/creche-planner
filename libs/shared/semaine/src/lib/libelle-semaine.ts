import { estSemaineIso, joursDeLaSemaine } from './semaine.js';

/**
 * Rend une semaine ISO (`YYYY-Www`) en **libellé parent sans jargon** :
 * « semaine du 6 au 12 juillet 2026 ». Les bornes (lundi / dimanche) viennent de
 * `joursDeLaSemaine` ; le nom du mois de `Intl.DateTimeFormat('fr-FR')`. Le mois de
 * la borne de **début** n'apparaît que lorsque la semaine chevauche deux mois
 * (« semaine du 29 juin au 5 juillet 2026 ») ; l'**année de la borne de fin** est
 * **toujours** affichée pour lever toute ambiguïté hors contexte, par exemple dans
 * un e-mail (hypothèse A8).
 *
 * Fonction **pure** : aucune horloge — l'année provient de la semaine, jamais de
 * `new Date()`. Le formatage se fait à partir des dates calendaires `YYYY-MM-DD`
 * (sans heure), en fuseau UTC, pour qu'aucun décalage local ne change le jour.
 * Repli sur la chaîne brute si la forme n'est pas `YYYY-Www` (jamais attendu en
 * pratique : les appelants passent une semaine déjà validée).
 *
 * Pendant côté serveur du `libelleSemaine` du web ; la seule différence est
 * l'année, ici **toujours** rendue (le mail est lu hors contexte).
 */
export function libelleSemaineFr(semaineIso: string): string {
  if (!estSemaineIso(semaineIso)) {
    return semaineIso;
  }
  // `joursDeLaSemaine` renvoie toujours 7 jours (lundi→dimanche) pour une semaine ISO
  // valide (garantie du module) : les bornes ne sont jamais indéfinies. `String(...)`
  // normalise le type d'index optionnel sans assertion (même idiome que `Number(m[1])`).
  const jours = joursDeLaSemaine(semaineIso);
  const lundi = String(jours[0]);
  const dimanche = String(jours[6]);
  const memeMois = lundi.slice(0, 7) === dimanche.slice(0, 7);
  const jourDebut = String(Number(lundi.slice(8, 10)));
  const jourFin = String(Number(dimanche.slice(8, 10)));
  const anneeFin = dimanche.slice(0, 4);
  const debut = memeMois ? jourDebut : `${jourDebut} ${nomMoisFr(lundi)}`;
  const fin = `${jourFin} ${nomMoisFr(dimanche)} ${anneeFin}`;
  return `semaine du ${debut} au ${fin}`;
}

/** Nom du mois en français d'une date `YYYY-MM-DD`, formaté en **UTC** (aucun décalage). */
function nomMoisFr(jourIso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    month: 'long',
  }).format(new Date(`${jourIso}T00:00:00.000Z`));
}
