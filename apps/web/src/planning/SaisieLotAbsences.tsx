import type { Dispatch, SetStateAction } from 'react';
import { Bouton } from '../ui/Bouton';
import {
  TYPES_ABSENCE,
  saisieAbsenceValide,
  type FormAbsence,
} from './saisieAbsence';

export interface SaisieLotAbsencesProps {
  form: FormAbsence;
  setForm: Dispatch<SetStateAction<FormAbsence>>;
  /** Nombre de jours cochés dans la liste clavier. */
  nbSelection: number;
  onAppliquerSelection: () => void;
  onAppliquerTous: () => void;
}

/**
 * Saisie EN LOT d'absences, accessible au clavier : un même ajustement posé
 * d'un coup sur la sélection ou sur tous les jours gardés du mois.
 *
 * La validité vérifiée ici est INDÉPENDANTE du jour (`saisieAbsenceValide`) :
 * la cohérence avec la plage de garde de chaque date est tranchée à
 * l'application, jour par jour, par `fenetreAbsence`.
 */
export function SaisieLotAbsences({
  form,
  setForm,
  nbSelection,
  onAppliquerSelection,
  onAppliquerTous,
}: SaisieLotAbsencesProps) {
  const plageValide = saisieAbsenceValide(form.typeAbsence, form);
  const typeAHeurePivot =
    form.typeAbsence === 'departAvance' ||
    form.typeAbsence === 'arriveeRetardee';

  return (
    <fieldset style={{ marginTop: '1rem' }}>
      <legend>Saisie en lot (accessible au clavier)</legend>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '0.75rem',
        }}
      >
        <fieldset
          style={{
            border: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
          }}
        >
          <legend style={{ padding: 0, fontSize: '0.82rem' }}>
            Type d’absence
          </legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {TYPES_ABSENCE.map((t) => (
              <label
                key={t.valeur}
                style={{
                  flexDirection: 'row',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="type-absence-lot"
                  checked={form.typeAbsence === t.valeur}
                  onChange={() => {
                    setForm((f) => ({ ...f, typeAbsence: t.valeur }));
                  }}
                />
                {t.libelle}
              </label>
            ))}
          </div>
        </fieldset>
        {typeAHeurePivot && (
          <label>
            {form.typeAbsence === 'departAvance'
              ? 'Nouvelle heure de départ'
              : 'Nouvelle heure d’arrivée'}
            <input
              type="time"
              value={form.heure}
              onChange={(e) => {
                const heure = e.target.value;
                setForm((f) => ({ ...f, heure }));
              }}
            />
          </label>
        )}
        {form.typeAbsence === 'personnalise' && (
          <>
            <label>
              Début de l’absence
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
              Fin de l’absence
              <input
                type="time"
                value={form.depart}
                onChange={(e) => {
                  const depart = e.target.value;
                  setForm((f) => ({ ...f, depart }));
                }}
              />
            </label>
          </>
        )}
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
      </div>
      {!plageValide && (
        <div
          className="muted"
          style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
        >
          {typeAHeurePivot
            ? 'Renseignez l’heure de l’ajustement.'
            : 'L’heure de départ doit être postérieure à l’arrivée.'}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginTop: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <Bouton
          onClick={onAppliquerSelection}
          disabled={nbSelection === 0 || !plageValide}
        >
          Appliquer à la sélection ({nbSelection})
        </Bouton>
        <Bouton
          variante="secondaire"
          onClick={onAppliquerTous}
          disabled={!plageValide}
        >
          Appliquer à tous les jours gardés
        </Bouton>
      </div>
    </fieldset>
  );
}
