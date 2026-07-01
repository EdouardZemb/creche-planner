import { useId, useState } from 'react';
import { api } from '../api/client';
import type { NotificationInApp } from '../types/bff';
import { formaterDateFr } from '../utils/dates';
import { useInbox } from './useInbox';

/** Rend un horodatage ISO (`2026-06-23T…`) en date française « 23/06/2026 ». */
function libelleDate(creeLe: string): string {
  return formaterDateFr(creeLe.slice(0, 10));
}

/**
 * Cloche de notifications de l'entête + compteur de non-lus (volet in-app de N3, PR6).
 * Affiche un **panneau journal** des notifications reçues « dans l'application »
 * (`GET /moi/notifications`) et permet de les **marquer lues** (`POST …/:id/lu`). C'est
 * un **journal informationnel** : il **ne duplique pas** l'action « Valider » (la source
 * de vérité actionnable reste l'encart `A_VALIDER` du planning). Discrète par dessein :
 * le compteur ne s'affiche qu'au-delà de zéro (comme `PastilleAValider`), et une panne /
 * absence de ligne parent laisse simplement la cloche sans compteur.
 *
 * Rendue dans l'entête dès qu'une identité est établie (cf. `App` / `Entete`).
 */
export function ClocheNotifications() {
  const [ouvert, setOuvert] = useState(false);
  const [version, setVersion] = useState(0);
  const [enCours, setEnCours] = useState<string | null>(null);
  const { data } = useInbox(version);
  const idPanneau = useId();

  const notifications: readonly NotificationInApp[] = data?.notifications ?? [];
  const nonLus = data?.nonLus ?? 0;

  async function marquerLue(id: string): Promise<void> {
    setEnCours(id);
    try {
      await api.marquerNotificationLue(id);
      setVersion((v) => v + 1); // resync compteur + états lus
    } catch {
      // Accusé de lecture best-effort : une panne ne doit pas casser l'entête.
    } finally {
      setEnCours(null);
    }
  }

  const libelleCloche =
    nonLus > 0
      ? `Notifications, ${nonLus} non lue${nonLus > 1 ? 's' : ''}`
      : 'Notifications';

  return (
    <div className="cloche" style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn secondaire cloche-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls={idPanneau}
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
        <section
          id={idPanneau}
          className="carte cloche-panneau"
          aria-label="Mes notifications"
          style={{
            position: 'absolute',
            right: 0,
            zIndex: 10,
            minWidth: 280,
            maxWidth: 360,
            marginTop: '0.25rem',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 'var(--h2)' }}>Notifications</h2>
          {notifications.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Aucune notification pour le moment.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {notifications.map((n) => {
                const lue = n.luLe !== null;
                return (
                  <li
                    key={n.id}
                    style={{
                      padding: '0.5rem 0',
                      borderTop: '1px solid var(--bordure, #e5e5e5)',
                      opacity: lue ? 0.65 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        alignItems: 'baseline',
                      }}
                    >
                      <strong style={{ fontWeight: lue ? 400 : 600 }}>
                        {n.sujet}
                      </strong>
                      <span
                        className="muted"
                        style={{ fontSize: '0.8em', whiteSpace: 'nowrap' }}
                      >
                        {libelleDate(n.creeLe)}
                      </span>
                    </div>
                    <p style={{ margin: '0.25rem 0 0' }}>{n.corps}</p>
                    {!lue && (
                      <button
                        type="button"
                        className="btn secondaire"
                        disabled={enCours === n.id}
                        style={{ marginTop: '0.35rem' }}
                        onClick={() => {
                          void marquerLue(n.id);
                        }}
                      >
                        {enCours === n.id
                          ? 'Enregistrement…'
                          : 'Marquer comme lu'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
