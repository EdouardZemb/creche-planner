import type { EventInput } from '@fullcalendar/core';

/**
 * Fabrique une pastille FullCalendar « pleine journée » — la seule forme
 * d'évènement que produisent les calendriers mensuels.
 *
 * L'`id` est un PARAMÈTRE et non une dérivation de la date : les deux
 * calendriers ne l'attribuent pas de la même façon (crèche : la date nue pour
 * un jour gardé, `sup-<date>` pour un jour ajouté — deux pastilles peuvent
 * coexister sur la même date ; ABCM : `<titre>-<date>`). Les unifier
 * changerait les identifiants rendus par FullCalendar.
 */
export function evenementJour(
  id: string,
  date: string,
  couleur: string,
  titre: string,
): EventInput {
  return {
    id,
    start: date,
    allDay: true,
    backgroundColor: couleur,
    borderColor: couleur,
    title: titre,
  };
}
