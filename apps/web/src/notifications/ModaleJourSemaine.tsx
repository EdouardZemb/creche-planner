import type { Dispatch, SetStateAction } from 'react';
import type { Mode } from '../types/bff';
import { formaterDateFr } from '../utils/dates';
import { Bouton } from '../ui/Bouton';
import { Modale } from '../ui/Modale';
import {
  ChampsHeuresPresence,
  ChampsPreavisCertificat,
  type FormJour,
} from './champsJourSemaine';
import type { EtatDeduit } from './ajustementDeduit';

export interface ModaleJourSemaineProps {
  /** Prénom de l'enfant du contrat — le titre le porte, plusieurs éditeurs coexistent. */
  enfant: string;
  date: string;
  mode: Mode;
  form: FormJour;
  setForm: Dispatch<SetStateAction<FormJour>>;
  /** Plage arrivée/départ cohérente (départ après arrivée). */
  plageOk: boolean;
  /** Le contrat garde ce jour de semaine (crèche) → heures réelles ou absence. */
  estGarde: boolean;
  /** Écart déduit de la présence saisie, `null` hors saisie d'heures valide. */
  etatDeduit: EtatDeduit | null;
  /** Une saisie datée existe déjà ce jour → proposer « Supprimer ». */
  aSaisie: boolean;
  onConfirmer: () => void;
  onSupprimer: () => void;
  onFermer: () => void;
}

/**
 * Édition d'UN jour de la semaine notifiée, champs selon le mode du contrat.
 *
 * Crèche, jour gardé : on saisit les heures RÉELLES (préremplies avec le
 * contrat) et l'application en déduit l'état — le choix « absence / jour
 * ajouté » d'antan a disparu. Préavis et certificat n'apparaissent que là où
 * ils comptent : sur une absence pleine journée, ou sur une réduction d'heures
 * (candidate à déduction), jamais sur une extension pure.
 */
export function ModaleJourSemaine({
  enfant,
  date,
  mode,
  form,
  setForm,
  plageOk,
  estGarde,
  etatDeduit,
  aSaisie,
  onConfirmer,
  onSupprimer,
  onFermer,
}: ModaleJourSemaineProps) {
  return (
    <Modale titre={`${enfant} — ${formaterDateFr(date)}`} onClose={onFermer}>
      {mode === 'CRECHE_PSU' && estGarde && (
        <>
          {/* Jour gardé : heures réelles (l'app déduit l'état), ou absence
              pleine journée. Le radio Absence/Jour ajouté d'antan disparaît. */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: 0,
            }}
          >
            <input
              type="checkbox"
              checked={form.absentJournee}
              onChange={(e) => {
                const absentJournee = e.target.checked;
                setForm((f) => ({ ...f, absentJournee }));
              }}
            />
            Absent toute la journée
          </label>

          {form.absentJournee ? (
            <ChampsPreavisCertificat form={form} setForm={setForm} />
          ) : (
            <>
              <ChampsHeuresPresence
                form={form}
                setForm={setForm}
                plageOk={plageOk}
              />
              {/* État déduit annoncé en direct (durée + effet facturation). */}
              <p
                aria-live="polite"
                className="muted mt-2"
                style={{ fontSize: '0.85rem' }}
              >
                {etatDeduit?.message ?? ''}
              </p>
              {etatDeduit?.reductionPresente === true && (
                <ChampsPreavisCertificat form={form} setForm={setForm} />
              )}
            </>
          )}
        </>
      )}

      {mode === 'CRECHE_PSU' && !estGarde && (
        // Jour non gardé : implicitement un « jour ajouté » (heures par défaut).
        <ChampsHeuresPresence form={form} setForm={setForm} plageOk={plageOk} />
      )}

      {mode === 'CANTINE' && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            margin: 0,
          }}
        >
          <input
            type="checkbox"
            checked={form.cantine}
            onChange={(e) => {
              const cantine = e.target.checked;
              setForm((f) => ({ ...f, cantine }));
            }}
          />
          Cantine
        </label>
      )}

      {mode === 'PERISCOLAIRE' && (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: 0,
            }}
          >
            <input
              type="checkbox"
              checked={form.matin}
              onChange={(e) => {
                const matin = e.target.checked;
                setForm((f) => ({ ...f, matin }));
              }}
            />
            Matin
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: 0,
            }}
          >
            <input
              type="checkbox"
              checked={form.soir}
              onChange={(e) => {
                const soir = e.target.checked;
                setForm((f) => ({ ...f, soir }));
              }}
            />
            Soir
          </label>
        </div>
      )}

      {mode === 'ALSH' && (
        <>
          <label>
            Type
            <select
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as 'COMPLETE' | 'DEMI';
                setForm((f) => ({ ...f, type }));
              }}
            >
              <option value="COMPLETE">Journée complète</option>
              <option value="DEMI">Demi-journée</option>
            </select>
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
              checked={form.repas}
              onChange={(e) => {
                const repas = e.target.checked;
                setForm((f) => ({ ...f, repas }));
              }}
            />
            Repas inclus
          </label>
        </>
      )}

      <div className="mt-4" style={{ display: 'flex', gap: '0.5rem' }}>
        <Bouton
          onClick={onConfirmer}
          // Une plage valide n'est requise que si l'on saisit des heures
          // (jour gardé sans « absent », ou jour ajouté) ; l'absence pleine
          // journée n'en dépend pas.
          disabled={mode === 'CRECHE_PSU' && !form.absentJournee && !plageOk}
        >
          Confirmer
        </Bouton>
        {aSaisie && (
          <Bouton variante="secondaire" onClick={onSupprimer}>
            Supprimer
          </Bouton>
        )}
        <Bouton variante="secondaire" onClick={onFermer}>
          Annuler
        </Bouton>
      </div>
    </Modale>
  );
}
