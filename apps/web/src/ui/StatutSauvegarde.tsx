export type EtatSauvegarde = 'idle' | 'en-cours' | 'enregistre' | 'erreur';

export interface StatutSauvegardeProps {
  etat: EtatSauvegarde;
  /** Heure « 21:43 » du dernier enregistrement (affichée à l'état « enregistre »). */
  enregistreA?: string | null;
}

const CLASSE: Record<Exclude<EtatSauvegarde, 'idle'>, string> = {
  'en-cours': 'badge statut-en-cours',
  enregistre: 'badge statut-enregistre',
  erreur: 'badge statut-erreur',
};

/**
 * Badge de statut de sauvegarde : rien en « idle », « Enregistrement… » pendant
 * l'écriture (debounce compris), puis « Enregistré à 21:43 » qui PERSISTE, ou
 * « Erreur d'enregistrement ». Une seule région `role="status"` pour tous les
 * états : les lecteurs d'écran n'entendent que les changements d'état — une
 * frappe qui relance le debounce ne mute pas le DOM (l'état reste « en-cours »)
 * et n'est donc pas annoncée.
 */
export function StatutSauvegarde({ etat, enregistreA }: StatutSauvegardeProps) {
  if (etat === 'idle') return null;
  const libelle =
    etat === 'en-cours'
      ? 'Enregistrement…'
      : etat === 'enregistre'
        ? enregistreA
          ? `Enregistré à ${enregistreA}`
          : 'Enregistré'
        : "Erreur d'enregistrement";
  return (
    <span className={CLASSE[etat]} role="status" aria-live="polite">
      {libelle}
    </span>
  );
}
