import { useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { formaterMoisFr } from '../utils/dates';
import { Bouton } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';
import { Modale } from '../ui/Modale';
import { Spinner } from '../ui/Spinner';

export interface ModaleCorrectionProps {
  /** Contrat dont on corrige une version. */
  contratId: string;
  /** Version corrigée (sa date d'effet ne bouge pas). */
  versionId: string;
  /** Enregistrement en cours (spinner + boutons désactivés). */
  enregistrement: boolean;
  /** Erreur d'enregistrement remontée par l'appelant (affichée dans la modale). */
  erreur?: string | null;
  /** Confirmé : lance la correction avec le motif optionnel saisi. */
  onConfirmer: (motif: string | undefined) => void;
  /** Fermeture sans corriger. */
  onAnnuler: () => void;
}

/** Énumère une liste de mois en langage parent (« juin, juillet et août »). */
function listerMois(mois: readonly string[]): string {
  const libelles = mois.map(formaterMoisFr);
  if (libelles.length <= 1) return libelles.join('');
  const debut = libelles.slice(0, -1).join(', ');
  return `${debut} et ${libelles[libelles.length - 1]}`;
}

/**
 * Aperçu d'impact **avant correction** d'une version (SFD 30, US-30-05). Rend, en
 * langage parent, les mois qui seront recalculés et — le cas échéant — un avertissement
 * pour ceux déjà **communiqués** à la crèche (récap envoyé). Un motif optionnel peut être
 * saisi. Bâtie sur `Modale` (bottom-sheet au mobile, focus-trap, Échap).
 */
export function ModaleCorrection({
  contratId,
  versionId,
  enregistrement,
  erreur,
  onConfirmer,
  onAnnuler,
}: ModaleCorrectionProps) {
  const [motif, setMotif] = useState('');
  const etat = useAsync(
    (signal) => api.apercuImpact(contratId, versionId, { signal }),
    [contratId, versionId],
  );

  const impact = etat.data;
  const moisRecalcules = impact?.moisCouverts ?? [];
  const moisCommuniques = impact?.moisCommuniques ?? [];

  return (
    <Modale titre="Corriger les paramètres actuels" onClose={onAnnuler}>
      <p className="muted mt-0">
        La correction remplace les paramètres de cette période sans en changer
        la date de début. Les mois concernés seront recalculés.
      </p>

      {etat.loading && (
        <div className="carte muted" aria-live="polite">
          <Spinner />
          <span className="texte-spinner">Calcul de l’impact…</span>
        </div>
      )}

      {etat.error && (
        <div className="carte" role="alert">
          <p className="texte-erreur">
            Impossible de calculer l’impact : {etat.error}
          </p>
          <Bouton
            variante="secondaire"
            onClick={() => {
              etat.reload();
            }}
          >
            Réessayer
          </Bouton>
        </div>
      )}

      {impact && (
        <>
          {moisRecalcules.length > 0 ? (
            <p>
              <strong>
                {moisRecalcules.length} mois
                {moisRecalcules.length > 1 ? ' seront' : ' sera'} recalculé
                {moisRecalcules.length > 1 ? 's' : ''}
              </strong>{' '}
              : {listerMois(moisRecalcules)}.
            </p>
          ) : (
            <p>Aucun mois enregistré n’est encore concerné.</p>
          )}

          {moisCommuniques.length > 0 && (
            <p className="bandeau-test" role="alert">
              <span aria-hidden="true">⚠ </span>
              Le récapitulatif de {listerMois(moisCommuniques)} a déjà été
              envoyé à la crèche. La correction recalcule{' '}
              {moisCommuniques.length > 1 ? 'ces mois' : 'ce mois'} : pensez à
              la prévenir si les montants changent.
            </p>
          )}

          <label htmlFor="correction-motif" className="mt-3">
            Motif (facultatif)
          </label>
          <textarea
            id="correction-motif"
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
            }}
            rows={2}
            placeholder="Ex. erreur de saisie sur les horaires"
            className="champ-large"
          />
        </>
      )}

      <ChampErreur balise="p">{erreur}</ChampErreur>

      <div className="mt-4" style={{ display: 'flex', gap: '0.5rem' }}>
        <Bouton
          variante="secondaire"
          onClick={onAnnuler}
          disabled={enregistrement}
        >
          Annuler
        </Bouton>
        <Bouton
          disabled={enregistrement || etat.loading || etat.error !== null}
          onClick={() => {
            onConfirmer(motif.trim() === '' ? undefined : motif.trim());
          }}
        >
          {enregistrement ? 'Enregistrement…' : 'Enregistrer la correction'}
        </Bouton>
      </div>
    </Modale>
  );
}
