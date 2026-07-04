import { useNotifications } from './useNotifications';

/**
 * Pastille de la navigation : compteur des semaines **à valider** du foyer actif
 * (indicateur in-app, Lot 4). Affichée au côté du lien « Planning ». Discrète par
 * dessein : rien à valider (ou chargement / erreur) ⇒ pas de pastille, pour ne pas
 * parasiter la navigation.
 */
export function PastilleAValider({ foyerId }: { foyerId: string }) {
  const { data } = useNotifications(foyerId);
  // Le compte annonce des SEMAINES : plusieurs contrats notifiés sur une même
  // semaine (un par enfant) ne comptent que pour une — sinon la pastille dirait
  // « 2 semaines à valider » là où la carte du tableau de bord n'en montre qu'une.
  const nombre = new Set((data ?? []).map((n) => n.semaineIso)).size;
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
