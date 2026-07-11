import { useEffect, useId, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useParams,
} from 'react-router-dom';
import { FoyerFormPage } from './foyer/FoyerFormPage';
import { FoyerModifierPage } from './foyer/FoyerModifierPage';
import { DashboardJourPage } from './dashboard/DashboardJourPage';
import { ContratsPage } from './foyer/ContratsPage';
import { PlanningPage } from './planning/PlanningPage';
import { CoutsAnnuelsPage } from './couts/CoutsAnnuelsPage';
import { EtablissementsPage } from './etablissements/EtablissementsPage';
import { MonProfilPage } from './profil/MonProfilPage';
import { DesabonnementPage } from './desabonnement/DesabonnementPage';
import { PastilleAValider } from './notifications/PastilleAValider';
import { ClocheNotifications } from './notifications/ClocheNotifications';
import { getFoyerId, setFoyerId, effacerFoyerId } from './utils/store';
import { seReconnecter } from './utils/reconnexion';
import { api } from './api/client';
import type { FoyerVue } from './types/bff';
import { useAsync } from './hooks/useAsync';
import { useFoyer } from './hooks/useFoyer';
import { useTitrePage } from './hooks/useTitrePage';
import { useAnnonceRoute } from './hooks/useAnnonceRoute';
import { EtatVide, type ActionEtatVide } from './ui/EtatVide';
import { MoiProvider, useMoi } from './session/MoiContext';

function Accueil() {
  const moi = useMoi();
  if (moi.loading) {
    return <p className="muted">Chargement de votre session…</p>;
  }

  // Mode BORNÉ : identité connue (Cloudflare Access B1 / en-tête de dev). Le foyer
  // découle de l'ensemble autorisé `moi.foyers`, plus d'un id localStorage forgeable.
  if (moi.email !== null) {
    // localStorage rétrogradé en simple cache : suivi UNIQUEMENT s'il appartient
    // à l'ensemble autorisé (sinon ignoré — ce n'est plus une source de vérité).
    const cache = getFoyerId();
    if (cache && moi.foyers.includes(cache)) {
      return <Navigate to={`/foyers/${cache}/dashboard`} replace />;
    }
    if (moi.foyers.length === 1) {
      return <Navigate to={`/foyers/${moi.foyers[0]}/dashboard`} replace />;
    }
    // 0 foyer (contactez l'admin) ou N foyers (sélecteur) : page dédiée.
    return <Navigate to="/mes-foyers" replace />;
  }

  // Mode HÉRITÉ : aucune identité (prod `GATEWAY_AUTH_DISABLED=1` sans Cloudflare,
  // ou dev sans en-tête). Comportement historique : cache localStorage puis
  // découverte serveur — la prod actuelle reste inchangée.
  const id = getFoyerId();
  if (id) {
    return <Navigate to={`/foyers/${id}/dashboard`} replace />;
  }
  return <AccueilDecouverte />;
}

/**
 * Page « mes foyers » (mode borné) : 0 foyer → `EtatVide` « Créer mon foyer »
 * (self-service de la 1ʳᵉ création, plus de renvoi vers un administrateur) ;
 * N foyers → sélecteur borné à l'ensemble autorisé. Atteinte depuis l'accueil ou
 * le lien « Mes foyers » de l'en-tête.
 */
function MesFoyersPage() {
  const moi = useMoi();
  useTitrePage('Mes familles');
  if (moi.loading) {
    return <p className="muted">Chargement de votre session…</p>;
  }
  if (moi.foyers.length === 0) {
    // P5 : self-service de la 1ʳᵉ création (besoin B). Sans foyer rattaché, on
    // propose de créer le sien plutôt que de renvoyer vers un administrateur.
    return (
      <EtatVide
        titre="Vous n’avez pas encore créé votre famille"
        description="Créez votre famille pour commencer à planifier la garde de vos enfants."
        actions={[
          { libelle: 'Créer ma famille', href: '/foyers/new', primaire: true },
        ]}
      />
    );
  }
  return (
    <EtatVide
      titre="Choisir une famille"
      description="Plusieurs familles vous sont rattachées. Choisissez celle à ouvrir."
      actions={moi.foyers.map((id, i) => ({
        libelle: `Ouvrir la famille ${i + 1}`,
        href: `/foyers/${id}/dashboard`,
        primaire: i === 0,
      }))}
    />
  );
}

/**
 * Aucun foyer mémorisé (première visite, autre navigateur, stockage effacé) :
 * avant de proposer la création, on demande au serveur les foyers déjà
 * configurés (GET /api/v1/foyers). S'il en existe, on ouvre le premier créé sur
 * son tableau de bord « Aujourd'hui » — l'app gère un foyer de référence unique —
 * et GardeFoyer le mémorisera dès son chargement. Liste vide ou erreur réseau →
 * formulaire de création (comportement historique : la découverte ne bloque
 * jamais l'accueil).
 */
function AccueilDecouverte() {
  const { data, loading } = useAsync<FoyerVue[]>(
    (signal) => api.listerFoyers({ signal }),
    [],
  );
  if (loading) {
    return <p className="muted">Recherche d’une famille existante…</p>;
  }
  const premier = data?.[0];
  return (
    <Navigate
      to={premier ? `/foyers/${premier.id}/dashboard` : '/foyers/new'}
      replace
    />
  );
}

function Entete() {
  // EX-02 : les liens dérivent du foyerId de la route active (URL = source de
  // vérité), jamais de localStorage. Aucun lien foyer hors d'un contexte /foyers/:id.
  const match = useMatch('/foyers/:foyerId/*');
  const foyerId = match?.params.foyerId;
  // La route /foyers/new partage le segment :foyerId ("new") : on n'affiche pas
  // les liens foyer pour cette pseudo-valeur.
  const id = foyerId && foyerId !== 'new' ? foyerId : null;
  const moi = useMoi();
  // P5 : un non-admin ne peut créer qu'à défaut de foyer (create-once) ; l'admin
  // crée sans limite, et le mode hérité reste permissif (`moi.admin` vrai).
  const peutCreerFoyer = moi.admin || moi.foyers.length === 0;
  const premierFoyer = moi.foyers[0];
  // Panneau « Plus » (mobile) : disclosure des pages de gestion, refermé au clic
  // de chaque lien (pas d'effet sur pathname — le clic est la cause directe).
  const { pathname } = useLocation();
  const [plusOuvert, setPlusOuvert] = useState(false);
  const idPanneauPlus = useId();
  const fermerPlus = () => {
    setPlusOuvert(false);
  };
  // Sur mobile, l'onglet « Plus » s'allume quand la page courante est l'une des
  // destinations rangées dans son panneau (au même titre qu'un NavLink actif).
  const plusActif =
    id !== null &&
    ['contrats', 'etablissements', 'modifier'].some(
      (segment) => pathname === `/foyers/${id}/${segment}`,
    );
  return (
    <header className="app-header">
      <a href="#contenu" className="skip-link">
        Aller au contenu
      </a>
      <NavLink to="/" end className="marque">
        Crèche Planner
      </NavLink>
      <nav aria-label="Navigation principale">
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
                Établissements
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
        {!id && (
          <>
            {/* Hors contexte foyer, peu de liens : ils restent dans l'en-tête
                (pas de barre d'onglets sans destinations quotidiennes). */}
            {moi.foyers.length > 1 && (
              <NavLink to="/mes-foyers">Mes familles</NavLink>
            )}
            {moi.email !== null && (
              <NavLink to="/mon-profil">Mon profil</NavLink>
            )}
            {/* P5 : hors d'un contexte foyer (le bloc `id` ci-dessus porte déjà
                « Modifier le foyer »), raccourci vers l'édition de SON foyer dès
                qu'au moins un foyer est rattaché. */}
            {premierFoyer && (
              <NavLink to={`/foyers/${premierFoyer}/modifier`}>
                Voir ma famille
              </NavLink>
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

/**
 * EX-01 : garde de route des pages foyer. Charge le foyer ; sur 404 affiche un
 * écran de récupération (« créer un foyer », « revenir à mon foyer »), sur 5xx /
 * réseau un écran « service indisponible » avec « Réessayer ». Sinon rend les
 * pages enfants via <Outlet/>.
 */
function GardeFoyer() {
  const { foyerId } = useParams<{ foyerId: string }>();
  const { data, error, erreurKind, reload } = useFoyer(foyerId ?? '');

  // Mémorise le foyer actif dès qu'il se charge (URL → localStorage) : la racine
  // « / » et les rechargements retrouvent ainsi le dernier foyer ouvert, même
  // arrivé par lien direct. Symétriquement, on oublie un foyer devenu introuvable
  // — mais seulement si c'est lui qui était mémorisé, pour ne pas effacer un bon
  // foyer pendant qu'on consulte l'URL (404) d'un autre.
  useEffect(() => {
    if (data && foyerId) setFoyerId(foyerId);
  }, [data, foyerId]);
  useEffect(() => {
    if (erreurKind === 'introuvable' && getFoyerId() === foyerId) {
      effacerFoyerId();
    }
  }, [erreurKind, foyerId]);

  if (error && erreurKind === 'introuvable') {
    return <FoyerIntrouvable />;
  }
  if (error && erreurKind === 'session-expiree') {
    return <SessionExpiree />;
  }
  if (error) {
    return <FoyerIndisponible onReessayer={reload} />;
  }
  return <Outlet />;
}

/**
 * Session Cloudflare Access expirée (prod uniquement) : le SW sert encore la
 * coquille mais l'API redirige vers la page de connexion. « Réessayer » serait
 * une impasse — la seule sortie est une vraie navigation réseau (cf.
 * `seReconnecter`), qui déclenche la reconnexion puis revient sur l'app.
 */
function SessionExpiree() {
  useTitrePage('Session expirée');
  return (
    <EtatVide
      titre="Session expirée"
      description="Votre session de connexion a expiré. Reconnectez-vous pour continuer."
      actions={[
        {
          libelle: 'Se reconnecter',
          onClick: () => void seReconnecter(),
          primaire: true,
        },
      ]}
    />
  );
}

function FoyerIntrouvable() {
  useTitrePage('Famille introuvable');
  const memorise = getFoyerId();
  const actions: ActionEtatVide[] = [
    {
      libelle: 'Créer une nouvelle famille',
      href: '/foyers/new',
      primaire: true,
    },
  ];
  if (memorise) {
    actions.push({
      libelle: 'Revenir à ma famille',
      href: `/foyers/${memorise}/dashboard`,
    });
  }
  return (
    <EtatVide
      titre="Famille introuvable"
      description="Cette famille n'existe pas ou a été supprimée."
      actions={actions}
    />
  );
}

function FoyerIndisponible({ onReessayer }: { onReessayer: () => void }) {
  useTitrePage('Service indisponible');
  return (
    <EtatVide
      titre="Service indisponible"
      description="Impossible de charger cette famille pour le moment. Réessayez dans un instant."
      actions={[{ libelle: 'Réessayer', onClick: onReessayer, primaire: true }]}
    />
  );
}

/** EX-03 : vraie page 404 avec des sorties explicites (pas de redirection muette). */
function PageIntrouvable() {
  useTitrePage('Page introuvable');
  return (
    <EtatVide
      titre="Page introuvable"
      description="La page demandée n'existe pas ou l'adresse est incorrecte."
      actions={[
        { libelle: 'Accueil', href: '/', primaire: true },
        { libelle: 'Nouvelle famille', href: '/foyers/new' },
      ]}
    />
  );
}

/**
 * UT-02 (WCAG 2.4.3) : titre de la page courante dérivé du `pathname`, en miroir
 * des `useTitrePage` déclarés par chaque page. Sert de texte d'annonce de route
 * (région live) — `useAnnonceRoute` ne le (re)publie qu'au changement de route.
 */
function titreDepuisPathname(pathname: string): string {
  if (pathname === '/foyers/new') return 'Créer ma famille';
  if (pathname === '/mes-foyers') return 'Mes familles';
  if (pathname === '/mon-profil') return 'Mon profil';
  if (pathname === '/desabonnement') return 'Désabonnement';
  const foyer =
    /^\/foyers\/[^/]+\/(dashboard|contrats|planning|couts|etablissements|modifier)$/.exec(
      pathname,
    );
  if (foyer) {
    const segment = foyer[1];
    if (segment === 'dashboard') return 'Aujourd’hui';
    if (segment === 'contrats') return 'Contrats';
    if (segment === 'planning') return 'Planning';
    if (segment === 'etablissements') return 'Établissements';
    if (segment === 'modifier') return 'Ma famille';
    return 'Coûts annuels';
  }
  // Pages de récupération / 404 et redirection racine : annonce neutre.
  return 'Crèche Planner';
}

/**
 * Coquille applicative rendue à l'intérieur du routeur : c'est ici que vit
 * `useAnnonceRoute` (qui dépend de `useLocation`). À chaque navigation, il
 * déplace le focus vers `<main id="contenu" tabindex="-1">` (cible du lien
 * d'évitement) et publie le titre courant dans la région live `aria-live="polite"`.
 */
function Coquille() {
  const { pathname } = useLocation();
  const { refCible, regionLiveProps } = useAnnonceRoute(
    titreDepuisPathname(pathname),
  );

  return (
    <>
      <Entete />
      {/* UT-02 CA2 : annonce de changement de page (titre courant), polie. Le
          testid la distingue des régions live de mutation des calendriers (AQ-05). */}
      <p {...regionLiveProps} className="sr-only" data-testid="annonce-route" />
      {/* UT-02 CA1 : cible de focus programmatique (tabindex=-1) et CA3 : ancre
          du lien d'évitement « Aller au contenu » (#contenu) préservée. */}
      <main id="contenu" tabIndex={-1} ref={refCible}>
        <Routes>
          <Route path="/" element={<Accueil />} />
          <Route path="/mes-foyers" element={<MesFoyersPage />} />
          <Route path="/mon-profil" element={<MonProfilPage />} />
          <Route path="/desabonnement" element={<DesabonnementPage />} />
          <Route path="/foyers/new" element={<FoyerFormPage />} />
          <Route path="/foyers/:foyerId" element={<GardeFoyer />}>
            {/* /foyers/:id nu rendait une page blanche (aucune route index) :
                on renvoie vers le tableau de bord, porte d'entrée du foyer. */}
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardJourPage />} />
            <Route path="contrats" element={<ContratsPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="couts" element={<CoutsAnnuelsPage />} />
            <Route path="etablissements" element={<EtablissementsPage />} />
            <Route path="modifier" element={<FoyerModifierPage />} />
          </Route>
          <Route path="*" element={<PageIntrouvable />} />
        </Routes>
      </main>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <MoiProvider>
        <Coquille />
      </MoiProvider>
    </BrowserRouter>
  );
}
