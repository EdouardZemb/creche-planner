import { Modale } from '../ui/Modale';
import { formaterDateFr } from '../utils/dates';
import { ChoixPortee, type Portee } from './ChoixPortee';
import { PiedModaleCalendrier } from './PiedModaleCalendrier';
import type { Effectif, ModeAbcm } from './inscriptionsAbcm';

export interface ModaleAjustementAbcmProps {
  /** Date ISO du jour ajusté. */
  date: string;
  /** CANTINE (une case) ou PERISCOLAIRE (matin/soir). */
  mode: Exclude<ModeAbcm, 'ALSH'>;
  valeurs: Effectif;
  onChangeValeurs: (maj: (precedent: Effectif) => Effectif) => void;
  portee: Portee;
  onChangePortee: (portee: Portee) => void;
  onConfirmer: () => void;
  /** Retour au contrat pour ce jour — absent quand il n'y a rien à défaire. */
  onReinitialiser?: (() => void) | undefined;
  onFermer: () => void;
}

/** Ajustement ponctuel d'un jour CANTINE ou PERISCOLAIRE. */
export function ModaleAjustementAbcm({
  date,
  mode,
  valeurs,
  onChangeValeurs,
  portee,
  onChangePortee,
  onConfirmer,
  onReinitialiser,
  onFermer,
}: ModaleAjustementAbcmProps) {
  return (
    <Modale titre={`Ajuster le ${formaterDateFr(date)}`} onClose={onFermer}>
      {mode === 'CANTINE' ? (
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
            checked={valeurs.cantine}
            onChange={(e) => {
              const { checked } = e.target;
              onChangeValeurs((f) => ({ ...f, cantine: checked }));
            }}
          />
          Cantine
        </label>
      ) : (
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
              checked={valeurs.matin}
              onChange={(e) => {
                const { checked } = e.target;
                onChangeValeurs((f) => ({ ...f, matin: checked }));
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
              checked={valeurs.soir}
              onChange={(e) => {
                const { checked } = e.target;
                onChangeValeurs((f) => ({ ...f, soir: checked }));
              }}
            />
            Soir
          </label>
        </div>
      )}

      <ChoixPortee valeur={portee} onChange={onChangePortee} nom="abcm" />

      <PiedModaleCalendrier
        onConfirmer={onConfirmer}
        secondaire={
          onReinitialiser === undefined
            ? undefined
            : { libelle: 'Réinitialiser', onClick: onReinitialiser }
        }
        onAnnuler={onFermer}
      />
    </Modale>
  );
}
