import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface ActionEtatVide {
  /** Libellé du bouton/lien. */
  libelle: string;
  /**
   * Si fourni, l'action est rendue comme un lien. Une `href` **interne**
   * (commençant par `/`) est rendue en navigation SPA (`<Link to>`), sauf si
   * `rechargement` est vrai ; une `href` externe reste un `<a href>` classique.
   */
  href?: string;
  /** Si fourni, l'action est rendue comme un bouton. */
  onClick?: () => void;
  /** Mise en avant visuelle (bouton primaire). Défaut : primaire pour la 1re. */
  primaire?: boolean;
  /**
   * Force un `<a href>` (rechargement complet) même pour une `href` interne. À
   * réserver aux sorties qui exigent un aller-retour réseau réel plutôt qu'une
   * transition SPA (p. ex. reconnexion Cloudflare Access après session expirée),
   * pour lesquelles une navigation client laisserait une session morte.
   */
  rechargement?: boolean;
}

export interface EtatVideProps {
  titre: string;
  description?: ReactNode;
  /** Une ou plusieurs actions de sortie (lien et/ou bouton). */
  actions?: ActionEtatVide[];
}

function classeAction(primaire: boolean): string {
  return primaire ? 'btn' : 'btn secondaire';
}

/**
 * Bloc d'état vide / erreur orienté action : titre + description optionnelle +
 * 0..n actions (liens ou boutons). Évite les impasses (cf. EX-01/03/07).
 */
export function EtatVide({ titre, description, actions = [] }: EtatVideProps) {
  return (
    <div className="etat-vide">
      <h2 className="etat-vide-titre">{titre}</h2>
      {description != null && (
        <p className="etat-vide-description">{description}</p>
      )}
      {actions.length > 0 && (
        <div className="etat-vide-actions">
          {actions.map((action, i) => {
            const primaire = action.primaire ?? i === 0;
            if (action.href != null) {
              // Interne (`/…`) sans rechargement forcé → transition SPA (pas de
              // rechargement complet de l'app). Externe ou `rechargement` →
              // `<a href>` classique (aller-retour réseau).
              const spa =
                action.href.startsWith('/') && action.rechargement !== true;
              if (spa) {
                return (
                  <Link
                    key={action.libelle}
                    to={action.href}
                    className={classeAction(primaire)}
                  >
                    {action.libelle}
                  </Link>
                );
              }
              return (
                <a
                  key={action.libelle}
                  href={action.href}
                  className={classeAction(primaire)}
                >
                  {action.libelle}
                </a>
              );
            }
            return (
              <button
                key={action.libelle}
                type="button"
                className={classeAction(primaire)}
                {...(action.onClick ? { onClick: action.onClick } : {})}
              >
                {action.libelle}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
