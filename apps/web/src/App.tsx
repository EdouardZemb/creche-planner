import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { FoyerFormPage } from './foyer/FoyerFormPage';
import { FoyerModifierPage } from './foyer/FoyerModifierPage';
import { MesFoyersPage } from './foyer/MesFoyersPage';
import { DashboardJourPage } from './dashboard/DashboardJourPage';
import { ContratsPage } from './foyer/ContratsPage';
import { PlanningPage } from './planning/PlanningPage';
import { CoutsAnnuelsPage } from './couts/CoutsAnnuelsPage';
import { EtablissementsPage } from './etablissements/EtablissementsPage';
import { MonProfilPage } from './profil/MonProfilPage';
import { TarifsPage } from './tarifs/TarifsPage';
import { DesabonnementPage } from './desabonnement/DesabonnementPage';
import { TitrePageContext, titreDocument } from './hooks/useTitrePage';
import { useAnnonceRoute } from './hooks/useAnnonceRoute';
import { BanniereHorsLigne } from './ui/BanniereHorsLigne';
import { MoiProvider } from './session/MoiContext';
import { Accueil } from './session/Accueil';
import { Entete } from './layout/Entete';
import { GardeFoyer } from './layout/GardeFoyer';
import { PageIntrouvable } from './layout/PageIntrouvable';
import { titreDepuisPathname } from './layout/titreDepuisPathname';

/**
 * Coquille applicative rendue à l'intérieur du routeur : c'est ici que vit
 * `useAnnonceRoute` (qui dépend de `useLocation`). À chaque navigation, il
 * déplace le focus vers `<main id="contenu" tabindex="-1">` (cible du lien
 * d'évitement) et publie le titre courant dans la région live `aria-live="polite"`.
 *
 * Le titre courant est la **source de vérité unique** posée par chaque page via
 * `useTitrePage` : `Coquille` le détient (`titre`), le fournit aux pages
 * (`TitrePageContext`) et le passe à l'annonce — l'annonce colle donc à l'écran
 * réellement affiché (dont les écrans de récupération au même chemin).
 */
function Coquille() {
  const { pathname } = useLocation();
  // Titre réel de la page courante (posé par `useTitrePage` de chaque écran).
  const [titre, setTitre] = useState('');
  const { refCible, regionLiveProps } = useAnnonceRoute(titre);

  // Repli du titre d'onglet : tant qu'aucune page n'a posé le sien (redirections,
  // premier rendu), on le dérive du chemin. Une page montée l'écrase aussitôt via
  // `useTitrePage`. L'annonce, elle, n'utilise PAS ce repli.
  useEffect(() => {
    if (titre === '') {
      document.title = titreDocument(titreDepuisPathname(pathname));
    }
  }, [pathname, titre]);

  return (
    <TitrePageContext.Provider value={{ definirTitre: setTitre }}>
      <Entete />
      {/* Conscience hors-ligne : bandeau discret rendu uniquement hors-ligne,
          collé sous l'en-tête et au-dessus du contenu — jamais dans la barre
          d'onglets fixe du bas. */}
      <BanniereHorsLigne />
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
          <Route path="/tarifs" element={<TarifsPage />} />
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
    </TitrePageContext.Provider>
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
