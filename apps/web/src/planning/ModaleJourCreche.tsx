import type { Dispatch, SetStateAction } from 'react';
import { Modale } from '../ui/Modale';
import { formaterDateFr } from '../utils/dates';
import { ChoixPortee, type Portee } from './ChoixPortee';
import { PiedModaleCalendrier } from './PiedModaleCalendrier';
import { plageValide } from './heures';
import {
  TYPES_ABSENCE,
  fenetreAbsence,
  type FormAbsence,
  type PlageGarde,
} from './saisieAbsence';

/**
 * Nature de la saisie du jour, décidée par le calendrier au clic : une absence
 * sur un jour gardé par le contrat, ou l'ajout d'un jour de garde.
 */
export type NatureSaisieJour = 'absence' | 'ajout';

export interface ModaleJourCrecheProps {
  date: string;
  nature: NatureSaisieJour;
  form: FormAbsence;
  setForm: Dispatch<SetStateAction<FormAbsence>>;
  /** Plage de garde du contrat ce jour-là, `null` si le jour n'est pas gardé. */
  garde: PlageGarde | null;
  portee: Portee;
  onChangePortee: (portee: Portee) => void;
  onConfirmer: () => void;
  /** Retrait de la saisie du jour — absent quand il n'y a rien à retirer. */
  onSupprimer?: (() => void) | undefined;
  onFermer: () => void;
}

/**
 * Saisie d'un jour du calendrier crèche.
 *
 * Pour une ABSENCE, l'utilisateur décrit sa PRÉSENCE (journée entière, départ
 * avancé, arrivée retardée, fenêtre libre) ; la fenêtre d'absence stockée en est
 * dérivée par `fenetreAbsence`, qui la refuse (`null`) si elle sort de la garde
 * du jour — c'est cette même dérivation qui décide ici si « Confirmer » est
 * actif. Pour un AJOUT, la saisie est directement la plage de présence.
 */
export function ModaleJourCreche({
  date,
  nature,
  form,
  setForm,
  garde,
  portee,
  onChangePortee,
  onConfirmer,
  onSupprimer,
  onFermer,
}: ModaleJourCrecheProps) {
  const typeAHeurePivot =
    form.typeAbsence === 'departAvance' ||
    form.typeAbsence === 'arriveeRetardee';
  const saisieValide =
    nature === 'absence'
      ? fenetreAbsence(form.typeAbsence, form, garde) !== null
      : plageValide(form.arrivee, form.depart);

  return (
    <Modale
      titre={
        nature === 'absence'
          ? `Absence du ${formaterDateFr(date)}`
          : `Ajouter le ${formaterDateFr(date)}`
      }
      onClose={onFermer}
    >
      {nature === 'absence' ? (
        <>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ padding: 0, fontSize: '0.9rem' }}>
              Type d’absence
            </legend>
            {TYPES_ABSENCE.map((t) => (
              <label
                key={t.valeur}
                style={{
                  flexDirection: 'row',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: '0.15rem 0',
                }}
              >
                <input
                  type="radio"
                  name="type-absence"
                  checked={form.typeAbsence === t.valeur}
                  onChange={() => {
                    setForm((f) => ({ ...f, typeAbsence: t.valeur }));
                  }}
                />
                {t.libelle}
              </label>
            ))}
          </fieldset>

          {form.typeAbsence === 'journee' && (
            <div
              className="muted"
              style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}
            >
              Toute la journée gardée
              {garde ? ` (${garde.arrivee}–${garde.depart})` : ''}.
            </div>
          )}

          {typeAHeurePivot && (
            <label style={{ display: 'block', marginTop: '0.25rem' }}>
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
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginTop: '0.25rem',
              }}
            >
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
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            flexWrap: 'wrap',
            marginTop: '0.25rem',
          }}
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
      )}
      {!saisieValide && (
        <div
          className="muted"
          style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
        >
          {nature === 'absence' && typeAHeurePivot
            ? 'L’heure doit être comprise dans la plage de garde.'
            : 'L’heure de départ doit être postérieure à l’arrivée.'}
        </div>
      )}

      {nature === 'absence' && (
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
            style={{
              flexDirection: 'row',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              marginTop: '0.5rem',
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
      )}

      <ChoixPortee valeur={portee} onChange={onChangePortee} nom="creche" />

      <PiedModaleCalendrier
        onConfirmer={onConfirmer}
        confirmerDesactive={!saisieValide}
        secondaire={
          onSupprimer === undefined
            ? undefined
            : { libelle: 'Supprimer', onClick: onSupprimer }
        }
        onAnnuler={onFermer}
      />
    </Modale>
  );
}
