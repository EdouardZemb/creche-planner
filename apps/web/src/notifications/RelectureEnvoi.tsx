import { useState } from 'react';
import { api } from '../api/client';
import type { DeltaJour, EnvoiResultat } from '../types/bff';
import { messageErreur } from '../utils/erreurs';
import { useAsync } from '../hooks/useAsync';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';

/** `2026-06-29` → `29/06/2026` (affichage FR). */
function jourLisible(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/** Courte description d'un jour modifié pour la relecture (date + nature). */
function descriptionJour(jour: DeltaJour): string {
  if (jour.apres === null) {
    return `${jourLisible(jour.date)} — journée retirée`;
  }
  return `${jourLisible(jour.date)} — modifiée`;
}

/** Message de résultat selon l'issue réelle de l'envoi. */
function libelleResultat(r: EnvoiResultat): string {
  switch (r.statut) {
    case 'DRY_RUN':
      return `Aperçu validé en mode dry-run : aucun mail réel n'a été envoyé à ${r.destinataire}.`;
    case 'ENVOYE':
      return `Mail envoyé au service (${r.destinataire}).`;
    case 'ECHEC':
      return `Échec de l'envoi : ${r.erreur ?? 'erreur inconnue'}.`;
    default:
      return `Envoi en cours…`;
  }
}

/**
 * Relecture humaine **obligatoire** puis envoi du mail au service (Lot 6). Affiche le
 * destinataire en évidence, le diff des modifications et le brouillon rendu, puis ne
 * déclenche l'**action sortante réelle** qu'après une confirmation explicite. Tant que
 * le brouillon n'est pas chargé, le bouton « Envoyer » reste désactivé. Un bandeau
 * « DRY-RUN actif » avertit quand l'envoi serait neutralisé (bac à sable ou
 * destinataire hors allowlist) : ce qui part alors est un aperçu, pas un vrai mail.
 */
export function RelectureEnvoi({
  contratId,
  semaineIso,
  onEnvoye,
}: {
  contratId: string;
  semaineIso: string;
  onEnvoye?: (resultat: EnvoiResultat) => void;
}) {
  const {
    data: brouillon,
    loading,
    error,
  } = useAsync(
    (signal) => api.lireBrouillon(contratId, semaineIso, { signal }),
    [contratId, semaineIso],
  );
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);

  const envoyer = async (): Promise<void> => {
    setConfirmer(false);
    setEnCours(true);
    setMessage(null);
    try {
      const resultat = await api.envoyerRecap(contratId, semaineIso);
      setMessage(libelleResultat(resultat));
      setEnvoye(true);
      onEnvoye?.(resultat);
    } catch (err) {
      setMessage(messageErreur(err));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section
      className="carte"
      aria-label="Relecture et envoi du mail au service"
      style={{ borderLeft: '4px solid var(--bleu)', marginTop: '1rem' }}
    >
      <h3 style={{ marginTop: 0 }}>Envoyer le récapitulatif au service</h3>

      {error !== null && (
        <p className="credit" role="alert">
          {error}
        </p>
      )}
      {loading && !brouillon && (
        <p className="credit">Chargement du brouillon…</p>
      )}

      {brouillon && (
        <>
          {brouillon.dryRun && (
            <p
              role="status"
              style={{
                background: 'var(--jaune-clair, #fff3cd)',
                border: '1px solid var(--jaune, #e0a800)',
                borderRadius: '4px',
                padding: '0.5rem 0.75rem',
                margin: '0 0 0.75rem',
              }}
            >
              <strong>DRY-RUN actif</strong> — aucun mail réel ne partira ; cet
              envoi produit un aperçu tracé.
            </p>
          )}

          <p style={{ margin: '0.25rem 0' }}>
            Destinataire :{' '}
            <strong>
              {brouillon.etablissementLibelle} &lt;{brouillon.destinataire}&gt;
            </strong>
          </p>
          <p style={{ margin: '0.25rem 0' }}>
            Objet : <em>{brouillon.sujet}</em>
          </p>

          {brouillon.deltaModifs.jours.length > 0 ? (
            <>
              <p style={{ margin: '0.5rem 0 0.25rem' }}>Modifications :</p>
              <ul style={{ margin: 0 }}>
                {brouillon.deltaModifs.jours.map((j) => (
                  <li key={j.date}>{descriptionJour(j)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="credit">
              Aucune modification déclarée sur cette semaine.
            </p>
          )}

          <details style={{ margin: '0.5rem 0' }}>
            <summary>Aperçu du message</summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--gris-clair, #f5f5f5)',
                padding: '0.5rem',
                borderRadius: '4px',
              }}
            >
              {brouillon.texte}
            </pre>
          </details>
        </>
      )}

      {message !== null && (
        <p className="credit" role="status">
          {message}
        </p>
      )}

      {/* Bouton toujours présent mais DÉSACTIVÉ tant que le brouillon n'est pas
          chargé (et après un envoi réussi) : on ne déclenche pas l'action sortante
          à l'aveugle, avant d'avoir la relecture sous les yeux. */}
      <button
        type="button"
        className="btn"
        disabled={!brouillon || enCours || envoye}
        onClick={() => {
          setConfirmer(true);
        }}
      >
        {enCours ? 'Envoi…' : envoye ? 'Envoyé' : 'Envoyer au service'}
      </button>

      {brouillon && (
        <ModaleConfirmation
          ouvert={confirmer}
          titre="Envoyer le récapitulatif au service ?"
          message={
            brouillon.dryRun
              ? `Mode dry-run : aucun mail réel ne sera envoyé à ${brouillon.destinataire}. Un aperçu sera journalisé.`
              : `Un mail réel va être envoyé à ${brouillon.destinataire}. Cette action est irréversible.`
          }
          libelleConfirmer={
            brouillon.dryRun ? 'Envoyer (dry-run)' : 'Envoyer le mail'
          }
          destructif={!brouillon.dryRun}
          onConfirmer={() => {
            void envoyer();
          }}
          onAnnuler={() => {
            setConfirmer(false);
          }}
        />
      )}
    </section>
  );
}
