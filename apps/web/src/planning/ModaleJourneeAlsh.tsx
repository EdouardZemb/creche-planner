import { Modale } from '../ui/Modale';
import { formaterDateFr } from '../utils/dates';
import { ChoixPortee, type Portee } from './ChoixPortee';
import { PiedModaleCalendrier } from './PiedModaleCalendrier';

/** Formule saisie dans la modale ALSH. */
export interface FormuleAlsh {
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

export interface ModaleJourneeAlshProps {
  /** Date ISO de la journée saisie. */
  date: string;
  valeurs: FormuleAlsh;
  onChangeValeurs: (maj: (precedent: FormuleAlsh) => FormuleAlsh) => void;
  portee: Portee;
  onChangePortee: (portee: Portee) => void;
  onConfirmer: () => void;
  /** Retrait de la journée — absent quand le jour n'est pas réservé. */
  onSupprimer?: (() => void) | undefined;
  onFermer: () => void;
}

/** Saisie d'une journée ALSH (formule + repas) pour une date. */
export function ModaleJourneeAlsh({
  date,
  valeurs,
  onChangeValeurs,
  portee,
  onChangePortee,
  onConfirmer,
  onSupprimer,
  onFermer,
}: ModaleJourneeAlshProps) {
  return (
    <Modale
      titre={`Journée ALSH du ${formaterDateFr(date)}`}
      onClose={onFermer}
    >
      <label>
        Type
        <select
          value={valeurs.type}
          onChange={(e) => {
            const type = e.target.value as 'COMPLETE' | 'DEMI';
            onChangeValeurs((f) => ({ ...f, type }));
          }}
        >
          <option value="COMPLETE">Journée complète</option>
          <option value="DEMI">Demi-journée</option>
        </select>
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
          checked={valeurs.repas}
          onChange={(e) => {
            const { checked } = e.target;
            onChangeValeurs((f) => ({ ...f, repas: checked }));
          }}
        />
        Repas inclus
      </label>

      <ChoixPortee valeur={portee} onChange={onChangePortee} nom="alsh" />

      <PiedModaleCalendrier
        onConfirmer={onConfirmer}
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
