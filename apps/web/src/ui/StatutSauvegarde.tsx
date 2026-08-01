import { Badge, type VarianteBadge } from './Badge';

export type EtatSauvegarde = 'idle' | 'en-cours' | 'enregistre' | 'erreur';

export interface StatutSauvegardeProps {
  etat: EtatSauvegarde;
  /** Heure « 21:43 » du dernier enregistrement (affichée à l'état « enregistre »). */
  enregistreA?: string | null;
}

const VARIANTE: Record<Exclude<EtatSauvegarde, 'idle'>, VarianteBadge> = {
  // « en cours » se rend avec la variante par défaut : l'ancienne règle
  // `.statut-en-cours` était le doublon strict de `.badge`.
  'en-cours': 'defaut',
  enregistre: 'succes',
  erreur: 'erreur',
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
    <Badge variante={VARIANTE[etat]} statutLive>
      {libelle}
    </Badge>
  );
}
