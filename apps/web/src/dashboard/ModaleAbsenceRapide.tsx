import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AbsenceCreche, EcrirePlanning } from '../types/bff';
import { Modale } from '../ui/Modale';
import { fenetreAbsence, type PlageGarde } from '../planning/saisieAbsence';
import { libelleDate } from '../utils/dates';
import { messageErreur } from '../utils/erreurs';
import { api } from '../api/client';

export interface ModaleAbsenceRapideProps {
  foyerId: string;
  contratId: string;
  /** Prénom de l'enfant (affichage). */
  enfant: string;
  /** Jour concerné `YYYY-MM-DD`. */
  dateIso: string;
  /** Mois `YYYY-MM` du jour (clé d'écriture du planning). */
  mois: string;
  /** Plage de garde du jour (déjà résolue non-nulle par l'appelant : le bouton
   *  n'apparaît que si elle existe). */
  plageGarde: PlageGarde;
  onFermer: () => void;
  /** Appelée après une écriture réussie : l'appelant ferme, annonce et recharge. */
  onEnregistree: () => void;
}

// Saisie d'heures inutile pour une absence PLEINE journée (la fenêtre est dérivée
// de la seule plage de garde) : `fenetreAbsence('journee', …)` ignore ce param.
const SAISIE_VIDE = { arrivee: '', depart: '', heure: '' };

/**
 * Confirmation « Signaler une absence » en 2 taps (A1) : depuis une rangée de
 * garde crèche du dashboard, note l'enfant **absent toute la journée** sans champ
 * à remplir. L'écriture est un **read-modify-write** du mois (le PUT planning est
 * un remplacement complet) : on relit la saisie existante, on y fusionne la
 * nouvelle absence journée (préavis 0, sans certificat) en RETIRANT toute entrée
 * du même jour dans `ajustements`/`joursSupplementaires` (règle « un jour = une
 * saisie ») et en CONSERVANT tout le reste (autres jours, `complementMinutes`…),
 * puis on réécrit. Pour les cas riches (heures partielles, certificat, plusieurs
 * jours), un lien renvoie au planning.
 */
export function ModaleAbsenceRapide({
  foyerId,
  contratId,
  enfant,
  dateIso,
  mois,
  plageGarde,
  onFermer,
  onEnregistree,
}: ModaleAbsenceRapideProps) {
  const refConfirmer = useRef<HTMLButtonElement>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Deep-link planning (même construction que le lien « Modifier » de la rangée)
  // pour préciser une absence partielle / avec certificat / multi-jours.
  const ciblePlanning = `/foyers/${foyerId}/planning?${new URLSearchParams({
    enfant,
    mode: 'CRECHE_PSU',
    mois,
  }).toString()}`;

  async function confirmer() {
    setEnCours(true);
    setErreur(null);
    try {
      // 1) Relire la saisie existante du mois (jamais en simulation).
      const { saisie } = await api.lirePlanning(contratId, mois, false);
      const base: EcrirePlanning = saisie ?? {};

      // 2) Nouvelle absence PLEINE journée (fenêtre = plage de garde du jour).
      const fenetre = fenetreAbsence('journee', SAISIE_VIDE, plageGarde);
      if (fenetre === null) {
        // Défensif : l'appelant garantit une plage non-nulle, mais on ne veut
        // jamais écrire une absence incohérente.
        throw new Error('La garde de ce jour est introuvable.');
      }
      const nouvelleAbsence: AbsenceCreche = {
        date: dateIso,
        ...fenetre,
        preavisJours: 0,
        certificatMaladie: false,
      };

      // 3) Fusion « un jour = une saisie » : on remplace toute absence du jour et
      // on retire ses ajustements / jours ajoutés, en CONSERVANT tout le reste.
      const corps: EcrirePlanning = {
        ...base,
        absences: [
          ...(base.absences ?? []).filter((a) => a.date !== dateIso),
          nouvelleAbsence,
        ],
        ajustements: (base.ajustements ?? []).filter((a) => a.date !== dateIso),
        joursSupplementaires: (base.joursSupplementaires ?? []).filter(
          (j) => j.date !== dateIso,
        ),
      };

      // 4) Réécrire le mois complet (jamais simule=true).
      await api.ecrirePlanning(contratId, mois, false, corps);
      onEnregistree();
    } catch (err) {
      // 5) Échec : rester dans la modale, nommer la cause, proposer « Réessayer ».
      setErreur(messageErreur(err));
      setEnCours(false);
    }
  }

  const libelleConfirmer = enCours
    ? 'Enregistrement…'
    : erreur !== null
      ? 'Réessayer'
      : "Confirmer l'absence";

  return (
    <Modale
      titre="Signaler une absence"
      onClose={onFermer}
      refFocusInitial={refConfirmer}
    >
      <p>
        <strong>{enfant}</strong> sera noté(e) absent(e) toute la journée du{' '}
        {libelleDate(dateIso)}.
      </p>
      <p className="muted">
        Horaires prévus : {plageGarde.arrivee}–{plageGarde.depart}.
      </p>
      {erreur !== null && (
        <p role="alert" className="texte-erreur">
          {erreur}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button
          type="button"
          className="btn"
          ref={refConfirmer}
          onClick={() => void confirmer()}
          disabled={enCours}
        >
          {libelleConfirmer}
        </button>
        <button
          type="button"
          className="btn secondaire"
          onClick={onFermer}
          disabled={enCours}
        >
          Annuler
        </button>
      </div>
      <p style={{ margin: '0.75rem 0 0' }}>
        <Link className="muted" to={ciblePlanning} onClick={onFermer}>
          Préciser (horaires, certificat, plusieurs jours)…
        </Link>
      </p>
    </Modale>
  );
}
