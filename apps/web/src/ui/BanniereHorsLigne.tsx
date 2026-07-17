import { useEnLigne } from '../hooks/useEnLigne';

/**
 * Bannière discrète rendue **uniquement** hors-ligne (`useEnLigne() === false`),
 * collée sous l'en-tête et au-dessus du contenu (jamais sur la barre d'onglets).
 * Elle dit honnêtement au parent que ce qu'il consulte peut dater de sa dernière
 * connexion — sans jamais faire passer un contenu en cache pour du contenu à
 * jour. `role="status"` + `aria-live="polite"` : annoncée une fois, sans voler
 * le focus.
 */
export function BanniereHorsLigne() {
  const enLigne = useEnLigne();
  if (enLigne) {
    return null;
  }
  return (
    <div className="banniere-hors-ligne" role="status" aria-live="polite">
      <strong>Vous êtes hors-ligne.</strong> Les informations affichées peuvent
      dater de votre dernière connexion.
    </div>
  );
}
