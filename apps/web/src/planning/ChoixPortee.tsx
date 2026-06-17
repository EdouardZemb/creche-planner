export type Portee = 'mois' | 'tous';

export interface ChoixPorteeProps {
  valeur: Portee;
  onChange: (portee: Portee) => void;
  /** Préfixe pour les `id`/`name` (unicité si plusieurs instances montées). */
  nom: string;
}

/**
 * Choix de la portée d'un ajustement : « ce mois uniquement » (saisie mensuelle,
 * le contrat reste la base) ou « tous les mois » (modification durable du
 * contrat). Le mois est le défaut, le cas le plus fréquent et le moins risqué.
 */
export function ChoixPortee({ valeur, onChange, nom }: ChoixPorteeProps) {
  return (
    <fieldset style={{ marginTop: '0.5rem', border: 'none', padding: 0 }}>
      <legend style={{ fontSize: '0.85rem', padding: 0 }}>Appliquer</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            margin: 0,
          }}
        >
          <input
            type="radio"
            name={`portee-${nom}`}
            checked={valeur === 'mois'}
            onChange={() => onChange('mois')}
            style={{ width: 'auto', padding: 0 }}
          />
          Ce mois uniquement
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
            type="radio"
            name={`portee-${nom}`}
            checked={valeur === 'tous'}
            onChange={() => onChange('tous')}
            style={{ width: 'auto', padding: 0 }}
          />
          Tous les mois (modifie le contrat)
        </label>
      </div>
    </fieldset>
  );
}
