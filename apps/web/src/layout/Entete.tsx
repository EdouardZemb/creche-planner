import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation, useMatch } from 'react-router-dom';
import { PastilleAValider } from '../notifications/PastilleAValider';
import { ClocheNotifications } from '../notifications/ClocheNotifications';
import { getFoyerId } from '../utils/store';
import { useMoi } from '../session/MoiContext';

/**
 * Destinations du panneau « Plus » qui vivent HORS d'un contexte /foyers/:id
 * (chemins fixes, sans segment de foyer). Elles allument l'onglet « Plus » au
 * même titre que les pages de gestion du foyer.
 */
const PAGES_GLOBALES_DU_PANNEAU = [
  '/tarifs',
  '/mes-foyers',
  '/mon-profil',
  '/foyers/new',
];

export function Entete() {
  // EX-02 : dans un contexte /foyers/:id, les liens dérivent du foyerId de la
  // route active (URL = source de vérité), jamais de localStorage.
  const match = useMatch('/foyers/:foyerId/*');
  const foyerIdRoute = match?.params.foyerId;
  // La route /foyers/new partage le segment :foyerId ("new") : cette
  // pseudo-valeur ne désigne aucun foyer, on n'en dérive aucun lien.
  const idRoute = foyerIdRoute && foyerIdRoute !== 'new' ? foyerIdRoute : null;
  const moi = useMoi();
  // P5 : un non-admin ne peut créer qu'à défaut de foyer (create-once) ; l'admin
  // crée sans limite, et le mode hérité reste permissif (`moi.admin` vrai).
  const peutCreerFoyer = moi.admin || moi.foyers.length === 0;
  // Foyer de RÉFÉRENCE de la barre d'onglets. Les pages GLOBALES (/tarifs,
  // /mon-profil, /mes-foyers, /foyers/new, 404) n'ont pas de :foyerId dans
  // l'URL : sans repli, la barre du bas disparaissait au profit de l'ancienne
  // nav textuelle d'en-tête — alors que la plupart de ces pages s'atteignent
  // DEPUIS le panneau « Plus » de cette même barre. La route garde la priorité
  // (EX-02 intact) ; à défaut seulement, on retombe sur le foyer mémorisé —
  // validé contre l'ensemble autorisé en mode borné, comme dans `Accueil` —
  // puis sur le premier foyer autorisé.
  const cache = getFoyerId();
  const cacheUtilisable =
    cache !== null && (moi.email === null || moi.foyers.includes(cache));
  // Tant que `/moi` n'a pas répondu, l'ensemble autorisé est INCONNU : le repli
  // par défaut (`email: null`) validerait n'importe quel cache, y compris celui
  // d'un autre parent (navigateur partagé, changement de compte). La barre
  // pointerait alors vers un foyer non autorisé et `PastilleAValider` émettrait
  // un GET scopé dessus — refusé (403) par `AppartenanceGuard`, donc comptabilisé
  // en `gateway_authz_refus_total{decision="refuse"}` : un faux positif sur
  // l'alerte `AuthzGatewayRefus`. On diffère donc la décision, comme le font déjà
  // `Accueil` et `MesFoyersPage` ; la route, elle, reste toujours utilisable.
  const id =
    idRoute ??
    (moi.loading ? null : cacheUtilisable ? cache : (moi.foyers[0] ?? null));
  // Panneau « Plus » (mobile) : disclosure des pages de gestion, refermé au clic
  // de chaque lien (pas d'effet sur pathname — le clic est la cause directe).
  const { pathname } = useLocation();
  const [plusOuvert, setPlusOuvert] = useState(false);
  const idPanneauPlus = useId();
  const refBoutonPlus = useRef<HTMLButtonElement>(null);
  const refNav = useRef<HTMLElement>(null);
  const fermerPlus = () => {
    setPlusOuvert(false);
  };

  /**
   * WCAG 2.2 — SC 2.4.11 « Focus non masqué (minimum) », AA.
   *
   * Sous 768 px, `.nav-plus-panneau.ouvert` est une **feuille fixe** posée
   * au-dessus du contenu (`position: fixed`, z-index 40). Ce panneau est un
   * _disclosure_ : il ne piège pas le focus et ne rend pas le reste inerte —
   * donc `Tab` depuis son dernier lien continuait **dans le contenu, sous la
   * feuille**. Mesuré au lot 9 sur les 8 routes auditées : 6 à 31 contrôles
   * par écran entièrement recouverts, dont les actions primaires (« Créer ma
   * famille », « Enregistrer », « Supprimer le contrat »).
   *
   * Le remède tient au fait que le panneau n'a **aucune raison de rester
   * ouvert** quand le focus l'a quitté : on le referme, ce qui découvre la
   * cible avant qu'elle ne reçoive le focus.
   *
   * Les écouteurs vivent sur le `document` plutôt que sur la `<nav>` : ce qu'on
   * surveille est l'arrivée du focus **ailleurs**, pas son départ d'ici. Un
   * `onBlur` de nav dirait la même chose de façon détournée — et `jsx-a11y`
   * refuse à juste titre un gestionnaire clavier sur un repère non interactif.
   */
  useEffect(() => {
    if (!plusOuvert) return;
    const surFocusEntrant = (e: FocusEvent) => {
      const cible = e.target;
      if (cible instanceof Node && refNav.current?.contains(cible) !== true)
        setPlusOuvert(false);
    };
    // Échap referme et rend le focus au bouton (motif disclosure APG).
    const surClavier = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPlusOuvert(false);
      refBoutonPlus.current?.focus();
    };
    document.addEventListener('focusin', surFocusEntrant);
    document.addEventListener('keydown', surClavier);
    return () => {
      document.removeEventListener('focusin', surFocusEntrant);
      document.removeEventListener('keydown', surClavier);
    };
  }, [plusOuvert]);
  // Sur mobile, l'onglet « Plus » s'allume quand la page courante est l'une des
  // destinations rangées dans son panneau (au même titre qu'un NavLink actif) —
  // pages de gestion du foyer comme pages globales.
  const plusActif =
    PAGES_GLOBALES_DU_PANNEAU.includes(pathname) ||
    (id !== null &&
      ['contrats', 'etablissements', 'unites-associatives', 'modifier'].some(
        (segment) => pathname === `/foyers/${id}/${segment}`,
      ));
  return (
    <header className="app-header">
      <a href="#contenu" className="skip-link">
        Aller au contenu
      </a>
      <NavLink to="/" end className="marque">
        Martha
      </NavLink>
      <nav aria-label="Navigation principale" ref={refNav}>
        {id && (
          <>
            {/* Destinations QUOTIDIENNES d'un parent : sur mobile, barre
                d'onglets fixe en bas de l'écran (zone du pouce) ; dès la
                tablette, `display: contents` les restitue à l'en-tête. */}
            <div className="nav-onglets">
              {/* Tableau de bord « ma journée » : visible dès qu'un foyer est
                  actif, pour tous les parents (NON conditionné `moi.admin`). */}
              <NavLink to={`/foyers/${id}/dashboard`} onClick={fermerPlus}>
                <span className="nav-onglet-icone" aria-hidden="true">
                  🏠
                </span>
                <span>Aujourd’hui</span>
              </NavLink>
              <NavLink to={`/foyers/${id}/planning`} onClick={fermerPlus}>
                <span className="nav-onglet-icone" aria-hidden="true">
                  📅
                </span>
                <span>Planning</span>
                <PastilleAValider foyerId={id} />
              </NavLink>
              {/* Libellé court sur l'onglet mobile, long dans l'en-tête desktop ;
                  le nom accessible reste « Coûts annuels » (aria-label ⊇ libellé
                  visible, WCAG 2.5.3). */}
              <NavLink
                to={`/foyers/${id}/couts`}
                aria-label="Coûts annuels"
                onClick={fermerPlus}
              >
                <span className="nav-onglet-icone" aria-hidden="true">
                  💶
                </span>
                <span className="nav-libelle-court">Coûts</span>
                <span className="nav-libelle-long">Coûts annuels</span>
              </NavLink>
              <button
                type="button"
                ref={refBoutonPlus}
                className={
                  plusActif ? 'nav-plus-bouton actif' : 'nav-plus-bouton'
                }
                aria-expanded={plusOuvert}
                aria-controls={idPanneauPlus}
                onClick={() => {
                  setPlusOuvert((o) => !o);
                }}
              >
                <span className="nav-onglet-icone" aria-hidden="true">
                  ⋯
                </span>
                <span>Plus</span>
              </button>
            </div>
            {/* Pages de GESTION (moins fréquentes) : panneau du bouton « Plus »
                sur mobile, liens d'en-tête ordinaires dès la tablette. */}
            <div
              id={idPanneauPlus}
              className={
                plusOuvert ? 'nav-plus-panneau ouvert' : 'nav-plus-panneau'
              }
            >
              <NavLink to={`/foyers/${id}/contrats`} onClick={fermerPlus}>
                Contrats
              </NavLink>
              <NavLink to={`/foyers/${id}/etablissements`} onClick={fermerPlus}>
                Crèches & écoles
              </NavLink>
              {/* SFD 40 — suivi des unités associatives. Consultation
                  ÉPISODIQUE (on y va après avoir réservé sur le site travaux,
                  ou quand l'échéance approche) : sa place est le panneau
                  « Plus », pas la barre d'onglets du pouce. */}
              <NavLink
                to={`/foyers/${id}/unites-associatives`}
                onClick={fermerPlus}
              >
                Unités associatives
              </NavLink>
              {/* Catalogue tarifaire GLOBAL (SFD 30, US-30-02) : saisie des grilles
                  de l'association. Accessible à tout parent authentifié (pas de
                  scoping foyer) ; lien global, hors segment :foyerId. */}
              <NavLink to="/tarifs" onClick={fermerPlus}>
                Tarifs
              </NavLink>
              {/* Édition du foyer par son **propriétaire** (parent) : visible dès
                  qu'un foyer est actif, NON conditionnée à `moi.admin` (le BFF
                  borne l'écriture via `@FoyerScope`). */}
              <NavLink to={`/foyers/${id}/modifier`} onClick={fermerPlus}>
                Ma famille
              </NavLink>
              {/* Mode borné, familles multi-foyers : accès au sélecteur. */}
              {moi.foyers.length > 1 && (
                <NavLink to="/mes-foyers" onClick={fermerPlus}>
                  Mes familles
                </NavLink>
              )}
              {/* « Mon profil » (A1) : édition de sa ligne parent + préférences de
                  notification. Visible dès qu'une identité est établie (le BFF résout
                  « moi » depuis l'e-mail vérifié) ; masqué en mode hérité sans identité. */}
              {moi.email !== null && (
                <NavLink to="/mon-profil" onClick={fermerPlus}>
                  Mon profil
                </NavLink>
              )}
              {/* P5 : création self-service de la 1ʳᵉ fois. Masquée pour un non-admin
                  qui a déjà un foyer (create-once → on oriente vers l'édition) ;
                  l'admin garde l'accès (provisioning) et le mode hérité (admin
                  permissif) reste inchangé. */}
              {peutCreerFoyer && (
                <NavLink to="/foyers/new" onClick={fermerPlus}>
                  Nouvelle famille
                </NavLink>
              )}
            </div>
          </>
        )}
        {!id && !moi.loading && (
          <>
            {/* AUCUN foyer de référence : identité sans foyer rattaché (P5,
                avant la 1ʳᵉ création) ou mode hérité sans foyer mémorisé. Il n'y
                a alors aucune destination quotidienne — donc pas de barre
                d'onglets — et les deux liens d'amorçage restent dans l'en-tête.
                Pendant le chargement de `/moi` on ne rend rien plutôt que ces
                liens : ils seraient remplacés par la barre d'onglets à la
                résolution (permutation visible à chaque chargement de page). */}
            {moi.email !== null && (
              <NavLink to="/mon-profil">Mon profil</NavLink>
            )}
            {peutCreerFoyer && (
              <NavLink to="/foyers/new">Nouvelle famille</NavLink>
            )}
          </>
        )}
      </nav>
      {/* Cloche in-app (PR6) : journal des notifications reçues + compteur de
          non-lus. Hors de la <nav> (c'est un bouton, pas un lien de navigation)
          et calée à droite de l'en-tête — sur mobile elle reste EN HAUT, à côté
          de la marque. Visible dès qu'une identité est établie (le BFF résout le
          parent depuis l'e-mail vérifié) ; masquée en mode hérité sans identité. */}
      {moi.email !== null && <ClocheNotifications />}
    </header>
  );
}
