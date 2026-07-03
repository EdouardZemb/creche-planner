export type Portee = 'mois' | 'tous';

export interface ChoixPorteeProps {
  valeur: Portee;
  onChange: (portee: Portee) => void;
  /** Préfixe pour les `id`/`name` (unicité si plusieurs instances montées). */
  nom: string;
}

/**
 * Choix de la portée d'un ajustement : « seulement cette fois » (saisie
 * mensuelle, le contrat reste la base) ou « toutes les semaines » (modification
 * durable du contrat). Le ponctuel est le défaut, le cas le plus fréquent et le
 * moins risqué ; l'option durable est visuellement démarquée (ambre + rappel
 * des conséquences) pour que l'engagement se distingue à la lecture (UX lot 4).
 */
export function ChoixPortee({ valeur, onChange, nom }: ChoixPorteeProps) {
  const idDescriptionDurable = `portee-${nom}-tous-description`;
  return (
    <fieldset style={{ marginTop: '0.5rem', border: 'none', padding: 0 }}>
      <legend style={{ fontSize: '0.85rem', padding: 0 }}>Appliquer</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
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
            onChange={() => {
              onChange('mois');
            }}
            style={{ width: 'auto', padding: 0 }}
          />
          Seulement cette fois
        </label>
        <div
          style={{
            borderLeft: '3px solid var(--ambre)',
            paddingLeft: '0.5rem',
          }}
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
              type="radio"
              name={`portee-${nom}`}
              checked={valeur === 'tous'}
              onChange={() => {
                onChange('tous');
              }}
              aria-describedby={idDescriptionDurable}
              style={{ width: 'auto', padding: 0 }}
            />
            Toutes les semaines, durablement (modifie le contrat)
          </label>
          <div
            id={idDescriptionDurable}
            style={{
              color: 'var(--ambre)',
              fontSize: '0.8rem',
              marginLeft: '1.4rem',
            }}
          >
            Ce jour changera chaque semaine, et les saisies déjà faites ce
            mois-ci seront effacées.
          </div>
        </div>
      </div>
    </fieldset>
  );
}
