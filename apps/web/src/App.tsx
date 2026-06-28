import { useEffect } from 'react';
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
import { ContratsPage } from './foyer/ContratsPage';
import { PlanningPage } from './planning/PlanningPage';
import { CoutsAnnuelsPage } from './couts/CoutsAnnuelsPage';
import { EtablissementsPage } from './etablissements/EtablissementsPage';
import { PastilleAValider } from './notifications/PastilleAValider';
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
      return <Navigate to={`/foyers/${cache}/planning`} replace />;
    }
    if (moi.foyers.length === 1) {
      return <Navigate to={`/foyers/${moi.foyers[0]}/planning`} replace />;
    }
    // 0 foyer (contactez l'admin) ou N foyers (sélecteur) : page dédiée.
    return <Navigate to="/mes-foyers" replace />;
  }

  // Mode HÉRITÉ : aucune identité (prod `GATEWAY_AUTH_DISABLED=1` sans Cloudflare,
  // ou dev sans en-tête). Comportement historique : cache localStorage puis
  // découverte serveur — la prod actuelle reste inchangée.
  const id = getFoyerId();
  if (id) {
    return <Navigate to={`/foyers/${id}/planning`} replace />;
  }
  return <AccueilDecouverte />;
}

/**
 * Page « mes foyers » (mode borné) : 0 foyer → écran « contactez l'administrateur »
 * (provisioning admin, option b-ii) ; N foyers → sélecteur borné à l'ensemble
 * autorisé. Atteinte depuis l'accueil ou le lien « Mes foyers » de l'en-tête.
 */
function MesFoyersPage() {
  const moi = useMoi();
  useTitrePage('Mes foyers');
  if (moi.loading) {
    return <p className="muted">Chargement de votre session…</p>;
  }
  if (moi.foyers.length === 0) {
    return (
      <EtatVide
        titre="Aucun foyer ne vous est rattaché"
        description="Votre compte n'est rattaché à aucun foyer. Contactez l'administrateur pour qu'il vous rattache au vôtre."
      />
    );
  }
  return (
    <EtatVide
      titre="Choisir un foyer"
      description="Plusieurs foyers vous sont rattachés. Choisissez celui à ouvrir."
      actions={moi.foyers.map((id, i) => ({
        libelle: `Ouvrir le foyer ${i + 1}`,
        href: `/foyers/${id}/planning`,
        primaire: i === 0,
      }))}
    />
  );
}

/**
 * Aucun foyer mémorisé (première visite, autre navigateur, stockage effacé) :
 * avant de proposer la création, on demande au serveur les foyers déjà
 * configurés (GET /api/v1/foyers). S'il en existe, on ouvre le premier créé —
 * l'app gère un foyer de référence unique — et GardeFoyer le mémorisera dès
 * son chargement. Liste vide ou erreur réseau → formulaire de création
 * (comportement historique : la découverte ne bloque jamais l'accueil).
 */
function AccueilDecouverte() {
  const { data, loading } = useAsync<FoyerVue[]>(
    (signal) => api.listerFoyers({ signal }),
    [],
  );
  if (loading) {
    return <p className="muted">Recherche d’un foyer existant…</p>;
  }
  const premier = data?.[0];
  return (
    <Navigate
      to={premier ? `/foyers/${premier.id}/planning` : '/foyers/new'}
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
            <NavLink to={`/foyers/${id}/contrats`}>Contrats</NavLink>
            <NavLink to={`/foyers/${id}/planning`}>
              Planning
              <PastilleAValider foyerId={id} />
            </NavLink>
            <NavLink to={`/foyers/${id}/couts`}>Coûts annuels</NavLink>
          </>
        )}
        {/* Mode borné, familles multi-foyers : accès au sélecteur. */}
        {moi.foyers.length > 1 && (
          <NavLink to="/mes-foyers">Mes foyers</NavLink>
        )}
        {/* Création réservée à l'admin (provisioning b-ii). Permissif tant que le
            gating ADMIN_EMAILS est inactif → la prod actuelle conserve le lien. */}
        {moi.admin && <NavLink to="/foyers/new">Nouveau foyer</NavLink>}
        <NavLink to="/etablissements">Établissements</NavLink>
      </nav>
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
  useTitrePage('Foyer introuvable');
  const memorise = getFoyerId();
  const actions: ActionEtatVide[] = [
    { libelle: 'Créer un nouveau foyer', href: '/foyers/new', primaire: true },
  ];
  if (memorise) {
    actions.push({
      libelle: 'Revenir à mon foyer',
      href: `/foyers/${memorise}/planning`,
    });
  }
  return (
    <EtatVide
      titre="Foyer introuvable"
      description="Ce foyer n'existe pas ou a été supprimé."
      actions={actions}
    />
  );
}

function FoyerIndisponible({ onReessayer }: { onReessayer: () => void }) {
  useTitrePage('Service indisponible');
  return (
    <EtatVide
      titre="Service indisponible"
      description="Impossible de charger ce foyer pour le moment. Réessayez dans un instant."
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
        { libelle: 'Nouveau foyer', href: '/foyers/new' },
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
  if (pathname === '/foyers/new') return 'Nouveau foyer';
  if (pathname === '/mes-foyers') return 'Mes foyers';
  if (pathname === '/etablissements') return 'Établissements';
  const foyer = /^\/foyers\/[^/]+\/(contrats|planning|couts)$/.exec(pathname);
  if (foyer) {
    const segment = foyer[1];
    if (segment === 'contrats') return 'Contrats';
    if (segment === 'planning') return 'Planning';
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
          <Route path="/etablissements" element={<EtablissementsPage />} />
          <Route path="/foyers/new" element={<FoyerFormPage />} />
          <Route path="/foyers/:foyerId" element={<GardeFoyer />}>
            <Route path="contrats" element={<ContratsPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="couts" element={<CoutsAnnuelsPage />} />
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
