import { useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { joursDuMois } from '../utils/dates';
import type { CalendrierResoluVue, JourResoluVue } from '../types/bff';

/**
 * Service réservable, DÉRIVÉ du contrat gelé plutôt que redéclaré : une union
 * recopiée ici divergerait le jour où le calendrier en ouvrirait un cinquième,
 * et le typecheck ne le verrait pas.
 */
export type ServiceOuvrable = JourResoluVue['servicesOuverts'][number];

export interface CalendrierOuverture {
  /** Le jour résolu, ou `null` si le mois n'est pas (encore) chargé. */
  jourResolu: (iso: string) => JourResoluVue | null;
  /**
   * Le service est-il réservable ce jour-là ? **Vrai par défaut** tant que le
   * calendrier n'est pas chargé ou qu'il est jugé absent (cf. la garde
   * ci-dessus) : on n'empêche pas une saisie sur la foi d'une donnée qu'on n'a
   * pas encore.
   */
  serviceOuvert: (iso: string, service: ServiceOuvrable) => boolean;
  /**
   * Motif affichable d'un jour NON réservable pour ce service, ou `null` si le
   * jour est réservable. C'est ce qui distingue un refus explicable d'un clic
   * sans effet — CA3 exige le motif, pas seulement le blocage.
   */
  motifFermeture: (iso: string, service: ServiceOuvrable) => string | null;
  /** Jours du mois, avec leur contexte, pour l'affichage de fond (US-31-04). */
  jours: readonly JourResoluVue[];
  /** Vrai tant que la lecture est en vol (aucune restriction appliquée). */
  chargement: boolean;
}

/** Libellés de repli, quand le calendrier ne nomme pas le jour. */
const MOTIF_PAR_CONTEXTE: Record<string, string> = {
  FERIE: 'jour férié',
  FERMETURE: 'établissement fermé',
  VACANCES: 'vacances scolaires',
  PERIODE_SCOLAIRE: 'période scolaire',
};

/** Préfixe de clé de cache — partagé avec l'invalidation de l'écran calendrier. */
export function clePlageCalendrier(etablissementId: string): string {
  return `calendrier:${etablissementId}:`;
}

/**
 * Calendrier d'ouverture du mois affiché, pour l'établissement d'un contrat.
 *
 * ── CE QUE CE HOOK NE FAIT PAS ───────────────────────────────────────────────
 *
 * Il ne rejoue **aucune** des trois couches du calendrier. La résolution
 * (récurrence, période, exception, férié, axe de connaissance) appartient au
 * domaine et sort de l'API sous forme de jours déjà tranchés. Un front qui
 * redériverait « le mercredi c'est l'ALSH » aurait deux vérités qui divergent au
 * premier régime de fériés particulier — et c'est la facturation qui trancherait,
 * après coup.
 *
 * ── LA GARDE QUI COMPTE : INCONNU ≠ FERMÉ ───────────────────────────────────
 *
 * `servicesOuverts` vide veut dire « fermé » **quand le calendrier existe**. Mais
 * un établissement dont personne n'a encore saisi la semaine type rend, lui
 * aussi, des jours à `servicesOuverts: []` — pour une tout autre raison. Traiter
 * les deux pareil rendrait **tout le planning non saisissable**, en silence, pour
 * tous les contrats de cet établissement.
 *
 * C'est exactement le défaut que le lot 4 a évité côté facturation (`LE-103`), et
 * il se reposerait ici à l'identique, avec un symptôme plus visible mais une
 * cause identique. La règle est donc la même, et elle est étroite :
 *
 *   **si AUCUN jour du mois n'ouvre quoi que ce soit, on ne restreint rien.**
 *
 * Un calendrier réel a toujours au moins un jour ouvert dans un mois — même une
 * crèche fermée trois semaines en août ouvre en septembre. Un mois entièrement
 * fermé est donc, en pratique, le signe d'un calendrier absent, pas d'une
 * fermeture. Dès qu'un seul jour ouvre un seul service, le calendrier fait
 * autorité, y compris pour fermer les autres.
 *
 * ⚠️ La limite est assumée et nommée : un établissement réellement fermé un mois
 * entier (une colonie qui n'ouvre qu'en juillet) verrait ses jours rester
 * saisissables ce mois-là. On préfère cette erreur-là — visible, et corrigée par
 * la génération des prestations qui, elle, refuse le jour — à l'inverse, qui
 * bloque un parent sans rien lui dire.
 */
export function useCalendrierOuverture(
  foyerId: string,
  etablissementId: string | null | undefined,
  mois: string,
): CalendrierOuverture {
  const jours = joursDuMois(mois);
  const du = jours[0] ?? `${mois}-01`;
  const au = jours.at(-1) ?? `${mois}-01`;

  const { data, loading } = useAsync<CalendrierResoluVue | null>(
    (signal) =>
      etablissementId === null || etablissementId === undefined
        ? Promise.resolve(null)
        : api.lireCalendrierResolu(foyerId, etablissementId, du, au, {
            signal,
          }),
    [foyerId, etablissementId, du, au],
    // Sans établissement il n'y a rien à mettre en cache : une clé constante
    // servirait la réponse d'un autre contrat.
    etablissementId === null || etablissementId === undefined
      ? {}
      : { cle: `${clePlageCalendrier(etablissementId)}${du}:${au}` },
  );

  const parJour = useMemo(() => {
    const index = new Map<string, JourResoluVue>();
    for (const jour of data?.jours ?? []) index.set(jour.jour, jour);
    return index;
  }, [data]);

  // La garde « inconnu ≠ fermé », évaluée une fois par mois chargé.
  const calendrierFaitAutorite = useMemo(
    () => (data?.jours ?? []).some((j) => j.servicesOuverts.length > 0),
    [data],
  );

  const jourResolu = useCallback(
    (iso: string): JourResoluVue | null => parJour.get(iso) ?? null,
    [parJour],
  );

  const serviceOuvert = useCallback(
    (iso: string, service: ServiceOuvrable): boolean => {
      if (!calendrierFaitAutorite) return true;
      const jour = parJour.get(iso);
      // Un jour hors de la plage chargée n'est pas un jour fermé : c'est un jour
      // qu'on n'a pas demandé.
      if (jour === undefined) return true;
      return jour.servicesOuverts.includes(service);
    },
    [calendrierFaitAutorite, parJour],
  );

  const motifFermeture = useCallback(
    (iso: string, service: ServiceOuvrable): string | null => {
      if (serviceOuvert(iso, service)) return null;
      const jour = parJour.get(iso);
      if (jour === undefined) return null;
      // Le libellé du calendrier d'abord (« Vacances de la Toussaint ») : c'est
      // le langage du parent. Le contexte n'est qu'un repli.
      const libelle = jour.libelle.trim();
      if (libelle !== '') return libelle;
      return MOTIF_PAR_CONTEXTE[jour.contexte] ?? 'jour non ouvert';
    },
    [parJour, serviceOuvert],
  );

  return {
    jourResolu,
    serviceOuvert,
    motifFermeture,
    jours: data?.jours ?? [],
    chargement: loading,
  };
}
