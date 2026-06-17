export type EtatSauvegarde = 'idle' | 'enregistre' | 'erreur';

export interface StatutSauvegardeProps {
  etat: EtatSauvegarde;
}

const LIBELLE: Record<Exclude<EtatSauvegarde, 'idle'>, string> = {
  enregistre: 'Enregistré',
  erreur: "Erreur d'enregistrement",
};

const CLASSE: Record<Exclude<EtatSauvegarde, 'idle'>, string> = {
  enregistre: 'badge statut-enregistre',
  erreur: 'badge statut-erreur',
};

/**
 * Badge de statut de sauvegarde : rien en « idle », « Enregistré » ou
 * « Erreur d'enregistrement ». Annoncé via `role="status"`.
 */
export function StatutSauvegarde({ etat }: StatutSauvegardeProps) {
  if (etat === 'idle') return null;
  return (
    <span className={CLASSE[etat]} role="status" aria-live="polite">
      {LIBELLE[etat]}
    </span>
  );
}
