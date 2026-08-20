import { brander, type Brand } from './branded.js';
import { InstantInvalideError } from './domain-error.js';

/**
 * **Instant de connaissance** — le second axe de temps du dépôt (SFD 31,
 * RM-31-03 ; décision PO du 2026-08-16).
 *
 * Le premier axe est le temps **métier** : quand une chose *a lieu*, ou à partir
 * de quand une valeur *s'applique*. C'est celui que porte `versionnement.ts`
 * (`PeriodeValidite`, dates d'effet) et celui que portent déjà les bornes `du`/`au`
 * d'une période de calendrier.
 *
 * Le second est le temps de **connaissance** : ce que le système *savait* à un
 * instant donné. Il ne répond pas « quand est-ce que ça se passe » mais « qu'est-ce
 * qu'on en disait quand on a facturé ». Une retouche du calendrier avance cet
 * axe-là, jamais l'autre.
 *
 * **Les deux ne se comparent jamais entre eux**, et c'est la raison d'être du type
 * brandé : un `Instant` n'est pas une date ISO nue, et le compilateur refuse qu'on
 * passe l'un pour l'autre. Les replier sur `string` « par confort » est le piège
 * nommé par le plan — le symptôme n'apparaîtrait qu'à la première retouche d'une
 * période passée, en production.
 *
 * **Invariant de représentation** : horodatage ISO 8601 UTC de largeur fixe,
 * `YYYY-MM-DDTHH:MM:SS.sssZ` (la forme rendue par `Date#toISOString`). La largeur
 * fixe et le `Z` obligatoire sont ce qui rend la comparaison **lexicographique**
 * équivalente à la comparaison chronologique — même propriété que les dates ISO,
 * obtenue de la même façon. Un décalage horaire (`+02:00`) est refusé : il
 * casserait cette équivalence sans rien signaler.
 */

const FORMAT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Horodatage UTC de largeur fixe, comparable lexicographiquement. */
export type Instant = Brand<string, 'Instant'>;

const marquer = brander<string, 'Instant'>();

/**
 * Construit un `Instant` depuis un horodatage ISO 8601 UTC
 * (`YYYY-MM-DDTHH:MM:SS.sssZ`). Lève `InstantInvalideError` sur toute autre forme
 * — offset horaire, précision différente, date nue.
 */
export function instant(valeur: string): Instant {
  if (!FORMAT_INSTANT.test(valeur)) {
    throw new InstantInvalideError(
      `instant invalide : ${valeur} (format attendu : YYYY-MM-DDTHH:MM:SS.sssZ)`,
    );
  }
  return marquer(valeur);
}
