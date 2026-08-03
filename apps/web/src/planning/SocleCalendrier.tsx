import type { ReactNode } from 'react';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventInput } from '@fullcalendar/core';
import { LegendePlanning } from './LegendePlanning';
import { BarreStatutCalendrier } from './BarreStatutCalendrier';
import { CalendrierMois } from './CalendrierMois';
import { ModaleContratDurable } from './ModaleContratDurable';
import type { UseCalendrierContratResultat } from './useCalendrierContrat';

export interface SocleCalendrierProps<P> {
  /** Résultat de `useCalendrierContrat` : le socle en câble toutes les sorties. */
  calendrier: UseCalendrierContratResultat<P>;
  /** Légende du mois (couleur du mode, libellé des jours du contrat, écart net). */
  legende: { couleur: string; libelle: string; ecartJours: number };
  /** Mois affiché « YYYY-MM ». */
  mois: string;
  events: EventInput[];
  onDateClick: (arg: DateClickArg) => void;
  /** Contrôles propres au mode DANS la barre de statut (complément, PAI…). */
  barre?: ReactNode;
  /** Message annexe APRÈS les erreurs de la barre (persistance indisponible). */
  barreApres?: ReactNode;
  /**
   * Consigne d'usage entre la légende et le calendrier. Optionnelle : le mode
   * ALSH place la sienne dans la barre de statut et n'en affiche AUCUNE ici —
   * l'omettre ne doit donc pas produire de conteneur vide.
   */
  consigne?: ReactNode;
  /** Listes clavier et modales propres au mode, sous le calendrier. */
  children?: ReactNode;
}

/**
 * Coquille commune des calendriers mensuels adossés à un contrat
 * (`CalendrierCreche`, `CalendrierAbcm`) : région live d'annonces, barre de
 * statut, légende, consigne, vue mensuelle et confirmation de modification
 * durable — dans cet ORDRE, qui est celui du DOM rendu jusqu'ici par les deux
 * composants.
 *
 * Elle ne connaît AUCUNE règle de mode : ni la dérivation des évènements, ni
 * les formulaires, ni les payloads. C'est délibéré — la logique métier des deux
 * calendriers (fenêtres d'absence horaires côté crèche, inscriptions booléennes
 * côté ABCM) n'a rien de commun, et la faire transiter par un objet de
 * « stratégie » ne partagerait que du câblage. Ce qui EST commun est
 * l'assemblage, et c'est exactement ce que ce composant porte. L'enveloppe
 * comportementale (écriture debouncée, réhydratation, portée, PUT durable) vit
 * de son côté dans `useCalendrierContrat`.
 */
export function SocleCalendrier<P>({
  calendrier,
  legende,
  mois,
  events,
  onDateClick,
  barre,
  barreApres,
  consigne,
  children,
}: SocleCalendrierProps<P>) {
  return (
    <div>
      {/* AQ-05 : annonce des mutations du calendrier aux lecteurs d'écran. */}
      <p {...calendrier.regionLiveProps} className="sr-only" />
      <BarreStatutCalendrier
        etat={calendrier.etat}
        enregistreA={calendrier.enregistreA}
        erreur={calendrier.erreur}
        onReessayer={calendrier.reessayer}
        erreurDurable={calendrier.erreurDurable}
        succesDurable={calendrier.succesDurable}
        apres={barreApres}
      >
        {barre}
      </BarreStatutCalendrier>

      <LegendePlanning
        couleurGarde={legende.couleur}
        libelleGarde={legende.libelle}
        ecartJours={legende.ecartJours}
      />

      {consigne !== undefined && (
        <div
          style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}
          className="muted"
        >
          {consigne}
        </div>
      )}

      <CalendrierMois mois={mois} events={events} onDateClick={onDateClick} />

      {children}

      {/* Confirmation d'une modification durable du contrat. */}
      <ModaleContratDurable
        confirmation={calendrier.confirmationDurable}
        onConfirmer={calendrier.confirmerDurable}
        onAnnuler={calendrier.annulerDurable}
      />
    </div>
  );
}
