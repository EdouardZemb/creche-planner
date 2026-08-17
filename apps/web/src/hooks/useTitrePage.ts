import { createContext, useContext, useEffect } from 'react';

/**
 * Nom du produit tel qu'il s'affiche (ADR-0009). Source unique des DEUX endroits qui
 * doivent s'accorder : le suffixe d'onglet ci-dessous et le repli neutre de
 * `titreDepuisPathname` — c'est leur désaccord qui produirait « Martha — Martha ».
 */
export const NOM_PRODUIT = 'Martha';

const SUFFIXE = ` — ${NOM_PRODUIT}`;

/**
 * Intitulé complet de l'onglet (`document.title`) pour un titre de page donné.
 *
 * Le repli neutre (`titreDepuisPathname` sur `/`, un écran de récupération ou une 404)
 * VAUT le nom du produit : lui apposer le suffixe donnerait « Martha — Martha ». Le
 * défaut existait déjà sous « Crèche Planner » — deux fois quatorze caractères passaient
 * pour une signature, un mot de six répété saute aux yeux.
 */
export function titreDocument(titre: string): string {
  return titre === NOM_PRODUIT ? NOM_PRODUIT : `${titre}${SUFFIXE}`;
}

/**
 * Source de vérité unique du titre de la page courante. Chaque écran le pose via
 * `useTitrePage` ; `Coquille` (App.tsx) fournit ce contexte au-dessus des `<Routes>`
 * et s'en sert pour l'annonce de route (région live) — l'annonce reflète ainsi
 * TOUJOURS l'écran réellement affiché, y compris un écran de récupération qui
 * remplace tardivement l'`<Outlet/>` au même chemin.
 *
 * Défaut hors provider : setter **no-op** (comme `MoiContext`), pour ne pas casser
 * les tests de pages isolées montées sans `Coquille`.
 */
export interface ContexteTitrePage {
  readonly definirTitre: (titre: string) => void;
}

const DEFAUT: ContexteTitrePage = {
  definirTitre: () => {
    /* no-op hors provider : pages montées sans Coquille (tests isolés) */
  },
};

export const TitrePageContext = createContext<ContexteTitrePage>(DEFAUT);

/**
 * Pose `document.title` à « <titre> — Martha » le temps où le composant est
 * monté, ET publie `<titre>` (sans le suffixe) dans le contexte de titre pour que
 * `Coquille` l'annonce. Restaure le titre d'onglet précédent au démontage.
 */
export function useTitrePage(titre: string): void {
  const { definirTitre } = useContext(TitrePageContext);
  useEffect(() => {
    const precedent = document.title;
    document.title = titreDocument(titre);
    definirTitre(titre);
    return () => {
      document.title = precedent;
    };
  }, [titre, definirTitre]);
}
