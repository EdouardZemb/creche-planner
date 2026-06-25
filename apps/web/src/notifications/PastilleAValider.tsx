import { useNotifications } from './useNotifications';

/**
 * Pastille de la navigation : compteur des semaines **à valider** du foyer actif
 * (indicateur in-app, Lot 4). Affichée au côté du lien « Planning ». Discrète par
 * dessein : rien à valider (ou chargement / erreur) ⇒ pas de pastille, pour ne pas
 * parasiter la navigation.
 */
export function PastilleAValider({ foyerId }: { foyerId: string }) {
  const { data } = useNotifications(foyerId);
  const nombre = data?.length ?? 0;
  if (nombre === 0) return null;
  return (
    <span
      className="pastille"
      aria-label={`${nombre} semaine${nombre > 1 ? 's' : ''} à valider`}
    >
      {nombre}
    </span>
  );
}
