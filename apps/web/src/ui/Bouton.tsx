import { forwardRef } from 'react';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

/**
 * Variantes d'action. Elles sont **mutuellement exclusives** : c'est exactement
 * ce que l'écriture littérale ne garantissait pas — `btn secondaire danger
 * contour` coexistait dans le code alors que la cascade (`.btn.danger.contour`,
 * spécificité 0,3,0) rendait `secondaire` (0,2,0) inerte.
 */
export type VarianteBouton =
  'primaire' | 'secondaire' | 'danger' | 'danger-contour';

/**
 * Les classes émises restent celles de `styles.css` : la cascade en dépend
 * (`.carte-contrat-actions .btn`, `.encart-actions .btn`, `.etab-actions .btn`
 * posent `width: 100%` en mobile), les états `:disabled` sont déclinés par
 * variante (couleurs EXPLICITES, jamais un `opacity` qui délaverait le contraste
 * AA) et `ModaleConfirmation.test.tsx` assert `toHaveClass('danger')`.
 */
const CLASSE: Record<VarianteBouton, string> = {
  primaire: 'btn',
  secondaire: 'btn secondaire',
  danger: 'btn danger',
  'danger-contour': 'btn danger contour',
};

/**
 * Classe d'une variante, éventuellement suffixée de classes de CONTEXTE
 * (`no-print`, `jour-action`, `cloche-item-action`, `cloche-bouton`). Exportée
 * pour les rares porteurs qui ne peuvent pas être un composant.
 */
export function classeBouton(
  variante: VarianteBouton = 'primaire',
  className?: string,
): string {
  return className === undefined || className === ''
    ? CLASSE[variante]
    : `${CLASSE[variante]} ${className}`;
}

export interface BoutonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  variante?: VarianteBouton;
  /** Classes de CONTEXTE uniquement (placement, impression) — jamais d'apparence. */
  className?: string;
  children: ReactNode;
}

/**
 * Bouton d'action. `type` vaut `button` par défaut : le défaut HTML est
 * `submit`, qui soumettrait le formulaire hôte au moindre oubli.
 *
 * `forwardRef` est structurant, pas décoratif : `Modale` pose le focus initial
 * via `refFocusInitial` (`ModaleConfirmation` la dirige vers « Annuler » pour ne
 * jamais armer l'action destructive) et son piège Tab filtre les focusables sur
 * l'attribut DOM `disabled` — un `aria-disabled` les rendrait tabulables.
 */
export const Bouton = forwardRef<HTMLButtonElement, BoutonProps>(
  function Bouton(
    { variante = 'primaire', className, type = 'button', children, ...reste },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={classeBouton(variante, className)}
        {...reste}
      >
        {children}
      </button>
    );
  },
);

export interface BoutonLienProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'className' | 'href'
> {
  /** Destination. Interne (`/…`) → transition SPA, sauf `rechargement`. */
  to: string;
  variante?: VarianteBouton;
  className?: string;
  /**
   * Force un `<a href>` (rechargement complet) même pour une destination
   * interne. À réserver aux sorties qui exigent un aller-retour réseau réel
   * (reconnexion Cloudflare Access), pour lesquelles une navigation client
   * laisserait une session morte.
   */
  rechargement?: boolean;
  children: ReactNode;
}

/**
 * Lien présenté comme un bouton. Volontairement SÉPARÉ de `Bouton` plutôt
 * qu'unifié derrière une prop `as` : un lien ne peut porter ni `type` ni
 * `disabled`, et le typage l'interdit ainsi par construction.
 *
 * Attention à l'impression : `@media print` masque `button`, pas `a`. Un
 * déclencheur d'impression doit donc rester un `Bouton`, jamais un `BoutonLien`.
 */
export function BoutonLien({
  to,
  variante = 'primaire',
  className,
  rechargement = false,
  children,
  ...reste
}: BoutonLienProps) {
  const classe = classeBouton(variante, className);
  if (to.startsWith('/') && !rechargement) {
    return (
      <Link to={to} className={classe} {...reste}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} className={classe} {...reste}>
      {children}
    </a>
  );
}
