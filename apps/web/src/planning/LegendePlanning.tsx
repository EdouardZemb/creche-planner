import { couleurAjoute, couleurRetire } from './couleursPlanning';

export interface LegendePlanningProps {
  /** Couleur des jours « gardés » du contrat (couleur du mode). */
  couleurGarde: string;
  /** Libellé des jours du contrat (ex. « Gardé », « Cantine »). */
  libelleGarde: string;
  /** Écart net de jours vs le contrat (ajouts − retraits) ce mois. */
  ecartJours: number;
}

/** Pastille colorée + libellé d'une entrée de légende. */
function Entree({ couleur, libelle }: { couleur: string; libelle: string }) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '0.8rem',
          height: '0.8rem',
          borderRadius: '0.2rem',
          backgroundColor: couleur,
          display: 'inline-block',
        }}
      />
      {libelle}
    </span>
  );
}

/**
 * Légende des états du calendrier (gardé / ajouté / retiré) et indicateur
 * d'écart vs le contrat pour le mois affiché. L'écart résume d'un coup d'œil
 * l'ampleur des ajustements ponctuels appliqués au-dessus de la semaine type.
 */
export function LegendePlanning({
  couleurGarde,
  libelleGarde,
  ecartJours,
}: LegendePlanningProps) {
  const ecartTexte =
    ecartJours === 0
      ? 'conforme au contrat'
      : `${ecartJours > 0 ? '+' : ''}${ecartJours} jour${
          Math.abs(ecartJours) > 1 ? 's' : ''
        } vs contrat`;

  return (
    <div
      role="group"
      aria-label="Légende du calendrier"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '1rem',
        fontSize: '0.82rem',
        marginBottom: '0.5rem',
      }}
      className="muted"
    >
      <Entree couleur={couleurGarde} libelle={libelleGarde} />
      <Entree couleur={couleurAjoute()} libelle="Ajouté" />
      <Entree couleur={couleurRetire()} libelle="Retiré / absent" />
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{ marginLeft: 'auto', fontWeight: 600 }}
      >
        Écart : {ecartTexte}
      </span>
    </div>
  );
}
