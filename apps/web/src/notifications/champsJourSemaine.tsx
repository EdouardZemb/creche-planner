import type { Dispatch, SetStateAction } from 'react';
import { ARRIVEE_DEFAUT, DEPART_DEFAUT } from '../planning/heures';

/**
 * Forme de la modale d'édition d'un jour de la semaine notifiée. Un SEUL objet
 * pour les quatre modes : chaque mode n'en lit que ses champs, ce qui évite une
 * union à discriminer dans tous les gestionnaires de saisie.
 */
export interface FormJour {
  /** Crèche, jour gardé : absence pleine journée (vs saisie d'heures réelles). */
  absentJournee: boolean;
  arrivee: string;
  depart: string;
  preavisJours: number;
  certificatMaladie: boolean;
  cantine: boolean;
  matin: boolean;
  soir: boolean;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

export const FORM_DEFAUT: FormJour = {
  absentJournee: false,
  arrivee: ARRIVEE_DEFAUT,
  depart: DEPART_DEFAUT,
  preavisJours: 0,
  certificatMaladie: false,
  cantine: false,
  matin: false,
  soir: false,
  type: 'COMPLETE',
  repas: false,
};

export interface ChampsFormJourProps {
  form: FormJour;
  setForm: Dispatch<SetStateAction<FormJour>>;
}

/** Champs heure d'arrivée / départ + message de plage invalide (crèche). */
export function ChampsHeuresPresence({
  form,
  setForm,
  plageOk,
}: ChampsFormJourProps & { plageOk: boolean }) {
  return (
    <>
      <div
        className="mt-2"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}
      >
        <label>
          Heure d’arrivée
          <input
            type="time"
            value={form.arrivee}
            onChange={(e) => {
              const arrivee = e.target.value;
              setForm((f) => ({ ...f, arrivee }));
            }}
          />
        </label>
        <label>
          Heure de départ
          <input
            type="time"
            value={form.depart}
            onChange={(e) => {
              const depart = e.target.value;
              setForm((f) => ({ ...f, depart }));
            }}
          />
        </label>
      </div>
      {!plageOk && (
        <div
          className="muted"
          style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
        >
          L’heure de départ doit être postérieure à l’arrivée.
        </div>
      )}
    </>
  );
}

/** Questions préavis + certificat, communes à l'absence et à la réduction d'heures. */
export function ChampsPreavisCertificat({
  form,
  setForm,
}: ChampsFormJourProps) {
  return (
    <>
      <label>
        Signalée combien de jours à l’avance ?
        <input
          type="number"
          min={0}
          value={form.preavisJours}
          onChange={(e) => {
            const preavisJours = parseInt(e.target.value, 10) || 0;
            setForm((f) => ({ ...f, preavisJours }));
          }}
        />
      </label>
      <label
        className="mt-2"
        style={{
          flexDirection: 'row',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
        }}
      >
        <input
          type="checkbox"
          checked={form.certificatMaladie}
          onChange={(e) => {
            const certificatMaladie = e.target.checked;
            setForm((f) => ({ ...f, certificatMaladie }));
          }}
        />
        Certificat médical
      </label>
    </>
  );
}
