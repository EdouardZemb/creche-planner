import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { NotificationInApp } from '../types/bff';
import { formaterDateHeureFr } from '../utils/dates';
import { Modale } from '../ui/Modale';
import { Spinner } from '../ui/Spinner';
import { EtatVide } from '../ui/EtatVide';
import { useInbox } from './useInbox';

/**
 * Cloche de notifications de l'entête + compteur de non-lus (volet in-app de N3, PR6).
 * Affiche un **panneau journal** des notifications reçues « dans l'application »
 * (`GET /moi/notifications`) et permet de les **marquer lues** (`POST …/:id/lu`). C'est
 * un **journal informationnel** : il **ne duplique pas** l'action « Valider » (la source
 * de vérité actionnable reste l'encart `A_VALIDER` du planning). Discrète par dessein :
 * le compteur ne s'affiche qu'au-delà de zéro (comme `PastilleAValider`), et une panne /
 * absence de ligne parent laisse simplement la cloche sans compteur.
 *
 * Le panneau est porté par la {@link Modale} (bottom-sheet plein-largeur sur mobile,
 * dialog centré ≥ 768px) : on hérite gratuitement de `role="dialog"`, du piège de focus,
 * de la restauration du focus sur la cloche, de la fermeture Échap et clic-extérieur.
 *
 * Rendue dans l'entête dès qu'une identité est établie (cf. `App` / `Entete`).
 */
export function ClocheNotifications() {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [marquageEnCours, setMarquageEnCours] = useState(false);
  const { data, loading, error, reload } = useInbox();

  const notifications: readonly NotificationInApp[] = data?.notifications ?? [];
  const nonLus = data?.nonLus ?? 0;
  const nonLusVisibles = notifications.filter((n) => n.luLe === null);

  async function marquerLue(id: string): Promise<void> {
    setEnCours(id);
    try {
      await api.marquerNotificationLue(id);
      reload(); // resync compteur + états lus
    } catch {
      // Accusé de lecture best-effort : une panne ne doit pas casser l'entête.
    } finally {
      setEnCours(null);
    }
  }

  /**
   * « Tout marquer comme lu » (H4) : pas de nouvel endpoint bulk — on rejoue
   * l'accusé idempotent existant sur les non-lus **visibles** (les ≤ 50 affichés ;
   * la pastille garde le reliquat). Best-effort (`Promise.allSettled` : un échec ne
   * casse pas l'entête), puis `reload()` resynchronise compteur et états lus.
   */
  async function toutMarquerLu(): Promise<void> {
    setMarquageEnCours(true);
    try {
      await Promise.allSettled(
        nonLusVisibles.map((n) => api.marquerNotificationLue(n.id)),
      );
      reload();
    } finally {
      setMarquageEnCours(false);
    }
  }

  /**
   * Tap sur une notification **avec lien** : le panneau se ferme à la navigation et
   * l'accusé de lecture part en **fire-and-forget** (une panne d'accusé ne doit jamais
   * empêcher la navigation, prise en charge par le `<Link>`). Une notif déjà lue ne
   * relance pas d'accusé inutile.
   */
  function ouvrirDepuisLien(n: NotificationInApp): void {
    setOuvert(false);
    if (n.luLe === null) {
      void marquerLue(n.id);
    }
  }

  const libelleCloche =
    nonLus > 0
      ? `Notifications, ${nonLus} non lue${nonLus > 1 ? 's' : ''}`
      : 'Notifications';

  // Corps du panneau selon l'état `useInbox`. L'entête (bouton + pastille) reste
  // insensible à `error` : une panne du compteur laisse la cloche sans chiffre, et
  // l'erreur n'apparaît QUE dans le dialog ouvert (préserve le dessein discret).
  let corps: ReactNode;
  if (loading && data === null) {
    corps = <Spinner label="Chargement des notifications…" />;
  } else if (error !== null && data === null) {
    corps = (
      <EtatVide
        titre="Notifications indisponibles"
        description="Impossible de charger vos notifications pour le moment."
        actions={[{ libelle: 'Réessayer', onClick: reload }]}
      />
    );
  } else if (notifications.length === 0) {
    corps = (
      <EtatVide
        titre="Aucune notification"
        description="Vous êtes à jour : rien de nouveau pour le moment."
      />
    );
  } else {
    corps = (
      <>
        {(nonLus > notifications.length || nonLusVisibles.length > 0) && (
          <div className="cloche-barre">
            {nonLus > notifications.length && (
              <p className="muted cloche-indice">
                {nonLus} non lues au total — les {notifications.length} plus
                récentes sont affichées ci-dessous.
              </p>
            )}
            {nonLusVisibles.length > 0 && (
              <button
                type="button"
                className="btn secondaire"
                disabled={marquageEnCours}
                onClick={() => {
                  void toutMarquerLu();
                }}
              >
                {marquageEnCours ? 'Enregistrement…' : 'Tout marquer comme lu'}
              </button>
            )}
          </div>
        )}
        <ul className="cloche-liste">
          {notifications.map((n) => {
            const lue = n.luLe !== null;
            const lien = n.lien ?? null;
            // Corps commun (titre + date + texte), tapable ou non selon le lien.
            const contenu = (
              <>
                <div className="cloche-item-entete">
                  <strong className="cloche-item-sujet">{n.sujet}</strong>
                  <span className="cloche-item-date">
                    {formaterDateHeureFr(n.creeLe)}
                  </span>
                </div>
                <p className="cloche-item-corps">{n.corps}</p>
              </>
            );
            return (
              <li
                key={n.id}
                className={lue ? 'cloche-item cloche-item--lu' : 'cloche-item'}
              >
                {lien !== null && lien !== '' ? (
                  // Carte entièrement tapable : mène à l'éditeur concerné et vaut
                  // accusé de lecture. Cible tactile pleine largeur.
                  <Link
                    to={lien}
                    className="cloche-carte-lien"
                    onClick={() => {
                      ouvrirDepuisLien(n);
                    }}
                  >
                    {contenu}
                  </Link>
                ) : (
                  <>
                    {contenu}
                    {!lue && (
                      <button
                        type="button"
                        className="btn secondaire cloche-item-action"
                        disabled={enCours === n.id}
                        onClick={() => {
                          void marquerLue(n.id);
                        }}
                      >
                        {enCours === n.id
                          ? 'Enregistrement…'
                          : 'Marquer comme lu'}
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <div className="cloche">
      <button
        type="button"
        className="btn secondaire cloche-bouton"
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label={libelleCloche}
        onClick={() => {
          setOuvert((o) => !o);
        }}
      >
        <span aria-hidden="true">🔔</span>
        {nonLus > 0 && (
          <span className="pastille" aria-hidden="true">
            {nonLus}
          </span>
        )}
      </button>

      {ouvert && (
        <Modale
          titre="Notifications"
          onClose={() => {
            setOuvert(false);
          }}
        >
          {corps}
        </Modale>
      )}
    </div>
  );
}
