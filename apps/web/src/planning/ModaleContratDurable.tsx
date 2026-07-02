import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import type { ConfirmationDurable } from './useCalendrierContrat';

export interface ModaleContratDurableProps<P> {
  confirmation: ConfirmationDurable<P> | null;
  onConfirmer: () => void;
  onAnnuler: () => void;
}

/**
 * Confirmation d'une modification durable du contrat (portée « tous les X »),
 * commune aux calendriers mensuels : même titre, libellé et caractère
 * destructif — seul le message (et le payload porté par le hook) varie.
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
    />
  );
}
