import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import type { ConfirmationDurable } from './useCalendrierContrat';

export interface ModaleContratDurableProps<P> {
  confirmation: ConfirmationDurable<P> | null;
  onConfirmer: () => void;
  onAnnuler: () => void;
}

/**
 * Confirmation d'une modification durable du contrat (portée « toutes les
 * semaines »), commune aux calendriers mensuels : même titre, libellé et
 * caractère destructif — seul le message mode-spécifique (« ce qui change
 * chaque semaine ») varie ; les conséquences communes (contrat modifié
 * durablement + saisies du mois effacées) sont rappelées ici en termes
 * concrets pour le parent (UX lot 4).
 */
export function ModaleContratDurable<P>({
  confirmation,
  onConfirmer,
  onAnnuler,
}: ModaleContratDurableProps<P>) {
  return (
    <ModaleConfirmation
      ouvert={confirmation !== null}
      titre="Modifier le contrat ?"
      message={confirmation?.message ?? ''}
      libelleConfirmer="Modifier le contrat"
      destructif
      onConfirmer={onConfirmer}
      onAnnuler={onAnnuler}
    >
      <div
        style={{
          borderLeft: '4px solid var(--ambre)',
          padding: '0.15rem 0 0.15rem 0.75rem',
          fontSize: '0.9rem',
        }}
      >
        <p style={{ margin: 0 }}>
          Ce changement vaudra pour toutes les semaines à venir, pas seulement
          ce mois-ci.
        </p>
        <p style={{ margin: '0.4rem 0 0' }}>
          Les saisies déjà faites ce mois-ci (absences, jours ajoutés,
          ajustements) seront effacées : il faudra les ressaisir si besoin.
        </p>
      </div>
    </ModaleConfirmation>
  );
}
