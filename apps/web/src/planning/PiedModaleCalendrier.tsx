import { Bouton } from '../ui/Bouton';

export interface PiedModaleCalendrierProps {
  onConfirmer: () => void;
  /** Confirmation impossible (saisie incohérente) — bouton `disabled` réel. */
  confirmerDesactive?: boolean | undefined;
  /**
   * Action intermédiaire, affichée seulement quand elle a un sens : retirer
   * l'absence saisie, réinitialiser un jour ajusté, supprimer une journée ALSH.
   * Les trois modales la placent ENTRE « Confirmer » et « Annuler ».
   */
  secondaire?: { libelle: string; onClick: () => void } | undefined;
  onAnnuler: () => void;
}

/**
 * Pied commun des modales de saisie des calendriers mensuels : « Confirmer »,
 * une action intermédiaire facultative, « Annuler ».
 *
 * « Annuler » reste en dernier et en variante secondaire dans les trois
 * modales : c'est l'ordre auquel `Modale` adosse son piège de tabulation.
 */
export function PiedModaleCalendrier({
  onConfirmer,
  confirmerDesactive,
  secondaire,
  onAnnuler,
}: PiedModaleCalendrierProps) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
      <Bouton onClick={onConfirmer} disabled={confirmerDesactive}>
        Confirmer
      </Bouton>
      {secondaire !== undefined && (
        <Bouton variante="secondaire" onClick={secondaire.onClick}>
          {secondaire.libelle}
        </Bouton>
      )}
      <Bouton variante="secondaire" onClick={onAnnuler}>
        Annuler
      </Bouton>
    </div>
  );
}
