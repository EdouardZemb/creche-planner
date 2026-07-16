import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Page **publique** de confirmation de désabonnement one-click (RFC 8058, PR5).
 * Atteinte via le lien « Se désabonner » d'un e-mail de rappel (`?token=…`). Elle
 * ne dépend d'aucune session (route hors `GardeFoyer`).
 *
 * Un désabonnement est un effet de bord : on ne le déclenche **jamais** sur un
 * simple GET (les antivirus/aperçus de messagerie pré-chargent les liens). L'action
 * n'a lieu que sur **clic explicite** (POST). Les issues métier sont distinguées :
 * succès, dernier canal d'un service (409, non coupable), lien invalide/expiré/déjà
 * utilisé (400) — chacune renvoyant vers « Mon profil » pour gérer ses préférences.
 */
type Etat =
  'saisie' | 'encours' | 'succes' | 'dernier-canal' | 'invalide' | 'erreur';

export function DesabonnementPage() {
  useTitrePage('Désabonnement');
  const [params] = useSearchParams();
  const token = params.get('token');
  const [etat, setEtat] = useState<Etat>(token ? 'saisie' : 'invalide');

  async function confirmer() {
    if (!token) {
      return;
    }
    setEtat('encours');
    try {
      await api.desabonner(token);
      setEtat('succes');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setEtat('dernier-canal');
      } else if (err instanceof ApiError && err.status === 400) {
        setEtat('invalide');
      } else {
        setEtat('erreur');
      }
    }
  }

  return (
    <div>
      <h1>Désabonnement</h1>

      {etat === 'saisie' && (
        <section className="carte page-etroite">
          <p className="profil-intro">
            Vous êtes sur le point de ne plus recevoir{' '}
            <strong>par e-mail</strong> les rappels du mardi (validation des
            besoins de la semaine).
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => void confirmer()}
          >
            Me désabonner
          </button>
        </section>
      )}

      {etat === 'encours' && (
        <div className="carte muted" role="status" aria-live="polite">
          Traitement en cours…
        </div>
      )}

      {etat === 'succes' && (
        <section className="carte" role="status" aria-live="polite">
          <p className="credit profil-intro">
            C’est fait : vous ne recevrez plus ces rappels par e-mail.
          </p>
          <p className="muted">
            Vous pouvez réactiver l’e-mail à tout moment depuis vos préférences.
          </p>
          <Link to="/mon-profil">Gérer mes préférences</Link>
        </section>
      )}

      {etat === 'dernier-canal' && (
        <section className="carte" role="alert">
          <p className="profil-intro">
            Ce rappel doit vous parvenir au moins d’une façon. Activez
            l’application avant de couper l’e-mail, depuis vos préférences.
          </p>
          <Link to="/mon-profil">Gérer mes préférences</Link>
        </section>
      )}

      {etat === 'invalide' && (
        <section className="carte" role="alert">
          <p className="profil-intro">
            Ce lien de désabonnement est invalide, expiré ou a déjà été utilisé.
          </p>
          <Link to="/mon-profil">Gérer mes préférences</Link>
        </section>
      )}

      {etat === 'erreur' && (
        <section className="carte" role="alert">
          <p className="profil-intro">
            Une erreur est survenue. Veuillez réessayer dans un instant.
          </p>
          <button
            type="button"
            className="btn secondaire"
            onClick={() => void confirmer()}
          >
            Réessayer
          </button>
        </section>
      )}
    </div>
  );
}
