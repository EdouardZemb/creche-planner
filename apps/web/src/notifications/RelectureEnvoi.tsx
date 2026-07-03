import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type {
  BrouillonEtablissement,
  DeltaJour,
  EnfantBrouillon,
  EnvoiEtablissementResultat,
} from '../types/bff';
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
function libelleResultat(r: EnvoiEtablissementResultat): string {
  switch (r.statut) {
    case 'DRY_RUN':
      return `Aperçu validé en mode dry-run : aucun mail réel n'a été envoyé à ${r.destinataire}.`;
    case 'ENVOYE':
      return `C'est fait : le service est prévenu (mail envoyé à ${r.destinataire}).`;
    case 'ECHEC':
      return `Échec de l'envoi : ${r.erreur ?? 'erreur inconnue'}.`;
    default:
      return `Envoi en cours…`;
  }
}

/**
 * Bloc de relecture + envoi pour **un établissement** : liste les enfants concernés et
 * leurs jours modifiés, affiche le destinataire en évidence, le bandeau DRY-RUN, puis
 * ne déclenche l'**action sortante réelle** qu'après une confirmation explicite.
 */
function BlocEnvoiEtablissement({
  foyerId,
  semaineIso,
  brouillon,
}: {
  foyerId: string;
  semaineIso: string;
  brouillon: BrouillonEtablissement;
}) {
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{
    type: 'succes' | 'erreur';
    texte: string;
  } | null>(null);
  const [envoye, setEnvoye] = useState(false);

  const envoyer = async (): Promise<void> => {
    setConfirmer(false);
    setEnCours(true);
    setMessage(null);
    try {
      const resultat = await api.envoyerRecapEtablissement(
        foyerId,
        semaineIso,
        brouillon.etablissementId,
      );
      const echec = resultat.statut === 'ECHEC';
      setMessage({
        type: echec ? 'erreur' : 'succes',
        texte: libelleResultat(resultat),
      });
      // Un statut ECHEC laissait le bouton verrouillé sur « Envoyé » alors que
      // rien n'était parti : on ne fige l'état qu'après un envoi réellement abouti.
      setEnvoye(!echec);
    } catch (err) {
      setMessage({ type: 'erreur', texte: messageErreur(err) });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--gris, #ddd)',
        paddingTop: '0.75rem',
        marginTop: '0.75rem',
      }}
    >
      <h4 style={{ margin: '0 0 0.25rem' }}>
        {brouillon.etablissementLibelle}
      </h4>

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
        Destinataire : <strong>{brouillon.destinataire}</strong>
      </p>
      <p style={{ margin: '0.25rem 0' }}>
        Objet : <em>{brouillon.sujet}</em>
      </p>

      <p style={{ margin: '0.5rem 0 0.25rem' }}>Enfants concernés :</p>
      <ul style={{ margin: 0 }}>
        {brouillon.enfants.map((enfant: EnfantBrouillon) => (
          <li key={enfant.contratId}>
            <strong>{enfant.enfant}</strong>
            {enfant.deltaModifs.jours.length > 0 && (
              <ul style={{ margin: '0.15rem 0' }}>
                {enfant.deltaModifs.jours.map((j) => (
                  <li key={j.date}>{descriptionJour(j)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

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

      {message !== null && (
        <p
          className={message.type === 'succes' ? 'credit' : 'debit'}
          role={message.type === 'succes' ? 'status' : 'alert'}
        >
          {message.texte}
        </p>
      )}

      <button
        type="button"
        className="btn"
        disabled={enCours || envoye}
        aria-label={`Envoyer le récapitulatif à ${brouillon.etablissementLibelle}`}
        onClick={() => {
          setConfirmer(true);
        }}
      >
        {enCours
          ? 'Envoi…'
          : envoye
            ? 'Envoyé ✓'
            : message?.type === 'erreur'
              ? `Réessayer l'envoi`
              : `Envoyer à ${brouillon.etablissementLibelle}`}
      </button>

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
    </div>
  );
}

/**
 * Relecture humaine **obligatoire** puis envoi des mails **agrégés par établissement**
 * (édition hebdo, Phase 4). Pour le foyer et la semaine, on découvre d'abord les
 * **établissements réels concernés** (entité libre par foyer, lien explicite
 * `contrat.etablissementId`) via la vue `semaine/besoins`, puis on charge le brouillon
 * agrégé de chacun par son `id`. On n'affiche un bloc relecture/envoi que pour ceux qui
 * ont **au moins un enfant** validé avec modifications. Chaque bloc déclenche un **mail
 * unique** regroupant tous les enfants concernés, après confirmation explicite ; un
 * bandeau « DRY-RUN actif » avertit quand l'envoi serait neutralisé.
 */
export function RelectureEnvoi({
  foyerId,
  semaineIso,
}: {
  foyerId: string;
  semaineIso: string;
}) {
  const { data, loading, error } = useAsync(
    async (signal) => {
      const semaine = await api.lireSemaineBesoins(foyerId, semaineIso, {
        signal,
      });
      // Un brouillon par établissement concerné, routé par son `id`. `allSettled` :
      // un établissement non routable (sans adresse de service → 404 amont) est
      // simplement écarté plutôt que de faire échouer toute la relecture.
      const brouillons = await Promise.allSettled(
        semaine.etablissements.map((e) =>
          api.lireBrouillonEtablissement(
            foyerId,
            semaineIso,
            e.etablissementId,
            {
              signal,
            },
          ),
        ),
      );
      return brouillons.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value] : [],
      );
    },
    [foyerId, semaineIso],
  );

  // On ne propose l'envoi que pour les établissements ayant au moins un enfant concerné.
  const concernes = (data ?? []).filter((b) => b.enfants.length > 0);

  // La section apparaît APRÈS que le parent a tapé « Valider » : sans coup de
  // pouce, elle peut rester hors écran sur mobile et l'étape d'envoi passe
  // inaperçue (le service ne serait jamais prévenu). Le focus programmatique
  // amène à la fois le scroll et la lecture d'écran sur la section.
  const refSection = useRef<HTMLElement | null>(null);
  useEffect(() => {
    refSection.current?.focus();
  }, []);

  return (
    <section
      ref={refSection}
      tabIndex={-1}
      className="carte"
      aria-label="Dernière étape : prévenir les services"
      style={{ borderLeft: '4px solid var(--ambre)', marginTop: '1rem' }}
    >
      <h3 style={{ marginTop: 0 }}>Dernière étape : prévenir les services</h3>
      {concernes.length > 0 && (
        <p style={{ marginTop: 0 }}>
          Votre semaine est validée, mais le service n’a pas encore reçu vos
          changements. Relisez le récapitulatif puis envoyez-le.
        </p>
      )}

      {error !== null && (
        <p className="debit" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p className="muted">Chargement des brouillons…</p>}

      {data && concernes.length === 0 && (
        <p className="muted">
          Aucune modification à transmettre à un service pour cette semaine.
        </p>
      )}

      {concernes.map((brouillon) => (
        <BlocEnvoiEtablissement
          key={brouillon.etablissementId}
          foyerId={foyerId}
          semaineIso={semaineIso}
          brouillon={brouillon}
        />
      ))}
    </section>
  );
}
