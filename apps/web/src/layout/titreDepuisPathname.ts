import { NOM_PRODUIT } from '../hooks/useTitrePage';

/**
 * Titre dérivé du `pathname`, en miroir des `useTitrePage` déclarés par chaque page.
 * Sert UNIQUEMENT de **repli du `document.title`** tant qu'aucune page n'a posé son
 * titre (redirections `Accueil`/`AccueilDecouverte`, tout premier rendu). L'annonce
 * de route (UT-02, WCAG 2.4.3), elle, ne lit QUE le titre RÉEL de la page (via le
 * `TitrePageContext`) — pour qu'un écran de récupération rendu au même chemin (ex.
 * « Famille introuvable ») soit annoncé correctement.
 */
export function titreDepuisPathname(pathname: string): string {
  if (pathname === '/foyers/new') return 'Créer ma famille';
  if (pathname === '/mes-foyers') return 'Mes familles';
  if (pathname === '/mon-profil') return 'Mon profil';
  if (pathname === '/desabonnement') return 'Désabonnement';
  if (pathname === '/mentions') return 'Informations sur vos données';
  // La liste blanche ci-dessous ne matche QUE des segments simples : elle ne
  // pourra jamais reconnaître un chemin profond. Étendre la regex l'aurait rendue
  // illisible pour un gain nul — un cas dédié dit mieux ce qu'il fait.
  if (/^\/foyers\/[^/]+\/etablissements\/[^/]+\/calendrier$/.test(pathname)) {
    return 'Calendrier';
  }
  const foyer =
    /^\/foyers\/[^/]+\/(dashboard|contrats|planning|couts|etablissements|unites-associatives|modifier)$/.exec(
      pathname,
    );
  if (foyer) {
    const segment = foyer[1];
    if (segment === 'dashboard') return 'Aujourd’hui';
    if (segment === 'contrats') return 'Contrats';
    if (segment === 'planning') return 'Planning';
    if (segment === 'etablissements') return 'Crèches & écoles';
    if (segment === 'unites-associatives') return 'Unités associatives';
    if (segment === 'modifier') return 'Ma famille';
    return 'Coûts annuels';
  }
  // Pages de récupération / 404 et redirection racine : annonce neutre. `titreDocument`
  // reconnaît ce cas et n'y appose PAS le suffixe (sinon « Martha — Martha »).
  return NOM_PRODUIT;
}
