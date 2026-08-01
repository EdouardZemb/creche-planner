import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import type { FoyerVersionVue } from '../types/bff';
import { centimesEnEuros } from '../utils/money';
import { formaterDateFr } from '../utils/dates';

/**
 * Historique des ressources d'un foyer (SFD 30, DV-03 / CA2 US-30-03) : la liste des
 * versions à date d'effet, de la plus récente à la plus ancienne, avec la tranche qui
 * s'appliquait alors. Lecture seule, langage parent (« À partir du … »). Une seule
 * version (foyer jamais modifié) → on n'affiche rien de superflu, juste l'entrée.
 */
export function HistoriqueRessources({
  foyerId,
}: {
  readonly foyerId: string;
}) {
  const { data, loading, error } = useAsync<readonly FoyerVersionVue[]>(
    (signal) => api.versionsFoyer(foyerId, { signal }),
    [foyerId],
  );

  if (loading) {
    return <p className="muted mt-0">Chargement de l’historique…</p>;
  }
  if (error || !data || data.length === 0) {
    // L'historique est un plus : un échec de lecture ne bloque pas l'édition.
    return null;
  }

  return (
    <section className="mt-5">
      <h2 className="mb-2" style={{ fontSize: '1rem' }}>
        Historique des ressources
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {data.map((v) => (
          <li
            key={v.id}
            className="muted"
            style={{ padding: '0.25rem 0', borderTop: '1px solid var(--bord)' }}
          >
            À partir du <strong>{formaterDateFr(v.dateEffet)}</strong> — revenu
            fiscal {centimesEnEuros(v.rfrCentimes)} — tranche {v.tranche}
          </li>
        ))}
      </ul>
    </section>
  );
}
