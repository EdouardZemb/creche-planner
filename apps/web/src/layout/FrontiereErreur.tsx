import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  detaillerErreur,
  signalerErreurClient,
  type OrigineErreurClient,
} from '../api/signalerErreur';

/**
 * **Frontière d'erreur React (lot C7, volet a).**
 *
 * `apps/web` n'en avait AUCUNE : toute exception levée pendant un rendu vidait
 * `#root` — page blanche, sans message, sans chemin de récupération. Ce n'est pas
 * théorique : en C1, une réponse d'API au schéma inattendu (`{semaines: []}` là où
 * un tableau était lu) a fait tomber tout l'arbre React et rendu muet un balayage
 * de 26 pages. En production, ce sera une réponse d'API, pas un mock.
 *
 * ⚠️ **Écart d'énoncé assumé** : le plan prévoyait un `errorElement` sur la route
 * racine. C'est une primitive des *data routers* (`createBrowserRouter`) ; l'app
 * utilise le routage déclaratif (`<BrowserRouter><Routes>`), où `errorElement`
 * n'existe pas. Migrer le routeur pour l'obtenir serait un chantier à soi seul,
 * au risque bien plus grand que le défaut corrigé — d'où cette frontière posée à
 * la main, qui rend le même service et se place où on veut.
 *
 * Seul un composant de CLASSE peut intercepter (aucun hook n'expose
 * `getDerivedStateFromError`) — c'est la seule classe React du dépôt, à dessein.
 *
 * **Ce qu'une frontière ne rattrape pas** (et qui reste donc couvert par les
 * gestionnaires globaux d'`installerRemonteeErreurs`) : les gestionnaires
 * d'événements, le code asynchrone, et les erreurs levées dans la frontière
 * elle-même. Ici, le `rendu` de repli doit donc rester simple et sans I/O.
 */

export interface RenduRecuperation {
  /** L'erreur interceptée, normalisée en `Error`. */
  readonly erreur: Error;
  /** Réarme la frontière et retente le rendu des enfants. */
  readonly reinitialiser: () => void;
}

export interface FrontiereErreurProps {
  readonly children: ReactNode;
  /** Étiquette de la frontière dans les journaux (cf. `OrigineErreurClient`). */
  readonly origine: OrigineErreurClient;
  /** Écran de récupération. Doit offrir une sortie — jamais une impasse. */
  readonly rendu: (details: RenduRecuperation) => ReactNode;
  /**
   * Réarmement automatique quand ces valeurs changent. **Indispensable sur la
   * frontière de route** : sans lui, une page qui plante fige l'écran de
   * récupération sur TOUTES les destinations suivantes (l'état d'erreur survit à
   * la navigation, puisque la frontière, elle, ne se démonte pas).
   */
  readonly clesReinitialisation?: readonly unknown[];
}

interface FrontiereErreurState {
  readonly erreur: Error | null;
  /** Copie des clés au moment du rendu courant (comparaison sans effet). */
  readonly cles: readonly unknown[];
}

const AUCUNE_CLE: readonly unknown[] = [];

function memesCles(a: readonly unknown[], b: readonly unknown[]): boolean {
  return (
    a.length === b.length && a.every((valeur, i) => Object.is(valeur, b[i]))
  );
}

/** `throw` accepte n'importe quelle valeur : on ramène tout à une `Error`. */
function normaliser(valeur: unknown): Error {
  if (valeur instanceof Error) return valeur;
  const { message } = detaillerErreur(valeur);
  return new Error(message);
}

export class FrontiereErreur extends Component<
  FrontiereErreurProps,
  FrontiereErreurState
> {
  constructor(props: FrontiereErreurProps) {
    super(props);
    this.state = {
      erreur: null,
      cles: props.clesReinitialisation ?? AUCUNE_CLE,
    };
  }

  static getDerivedStateFromError(valeur: unknown): { erreur: Error } {
    return { erreur: normaliser(valeur) };
  }

  /**
   * Réarmement piloté par les props, sans effet ni `componentDidUpdate` : un
   * `setState` dans un effet rendrait l'écran de récupération une frame de trop
   * après la navigation (et ferait clignoter la page d'arrivée).
   */
  static getDerivedStateFromProps(
    props: FrontiereErreurProps,
    state: FrontiereErreurState,
  ): FrontiereErreurState | null {
    const cles = props.clesReinitialisation ?? AUCUNE_CLE;
    if (memesCles(cles, state.cles)) return null;
    return { erreur: null, cles };
  }

  override componentDidCatch(erreur: unknown, infos: ErrorInfo): void {
    const details = detaillerErreur(erreur);
    signalerErreurClient({
      origine: this.props.origine,
      message: details.message,
      route: window.location.pathname,
      ...(details.pile !== undefined && { pile: details.pile }),
      ...(infos.componentStack != null && {
        composant: infos.componentStack.trim(),
      }),
    });
  }

  private readonly reinitialiser = (): void => {
    this.setState({ erreur: null });
  };

  override render(): ReactNode {
    const { erreur } = this.state;
    if (erreur !== null) {
      return this.props.rendu({ erreur, reinitialiser: this.reinitialiser });
    }
    return this.props.children;
  }
}
