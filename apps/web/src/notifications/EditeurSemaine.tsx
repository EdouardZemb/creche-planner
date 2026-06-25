import { useMemo } from 'react';
import { api } from '../api/client';
import type { ContratBesoinsSemaine } from '../types/bff';
import { useAsync } from '../hooks/useAsync';
import { EditeurContratSemaine } from './EditeurContratSemaine';

/** Rend `2026-W27` en libellé lisible « semaine 27 (2026) ». */
function libelleSemaine(semaineIso: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(semaineIso);
  if (!m) return semaineIso;
  return `semaine ${Number(m[2])} (${m[1]})`;
}

export interface EditeurSemaineProps {
  foyerId: string;
  semaineIso: string;
  onFermer: () => void;
  /** Notifie le parent qu'une écriture a abouti (rafraîchir un éventuel coût). */
  onEnregistre?: () => void;
}

/**
 * Éditeur **hebdomadaire consolidé** d'un foyer, ouvert depuis une notification.
 * Charge la vue agrégée (Phase 1), groupe les contrats actifs de la semaine par
 * **établissement → enfant/mode**, et rend chacun éditable (Phase 2) puis
 * validable par contrat. Périmètre borné à la **seule semaine notifiée** (décision
 * produit : pas de navigation inter-semaines).
 */
export function EditeurSemaine({
  foyerId,
  semaineIso,
  onFermer,
  onEnregistre,
}: EditeurSemaineProps) {
  const { data, loading, error } = useAsync(
    (signal) => api.lireSemaineBesoins(foyerId, semaineIso, { signal }),
    [foyerId, semaineIso],
  );

  // Regroupe les contrats par établissement, en conservant l'ordre de l'annuaire
  // renvoyé par le BFF (établissements concernés de la semaine).
  const groupes = useMemo(() => {
    if (!data) return [];
    const parCle = new Map<string, ContratBesoinsSemaine[]>();
    for (const c of data.contrats) {
      const liste = parCle.get(c.etablissementCle) ?? [];
      liste.push(c);
      parCle.set(c.etablissementCle, liste);
    }
    return data.etablissements
      .map((etab) => ({
        cle: etab.cle,
        libelle: etab.libelle,
        contrats: parCle.get(etab.cle) ?? [],
      }))
      .filter((g) => g.contrats.length > 0);
  }, [data]);

  return (
    <section
      className="carte"
      aria-label={`Éditer les besoins de la ${libelleSemaine(semaineIso)}`}
      style={{ borderLeft: '4px solid var(--bleu)', marginTop: '1rem' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0 }}>
          Éditer les besoins de la {libelleSemaine(semaineIso)}
        </h3>
        <button type="button" className="btn secondaire" onClick={onFermer}>
          Fermer
        </button>
      </div>

      {error !== null && (
        <p className="credit" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p className="credit">Chargement de la semaine…</p>}

      {data && groupes.length === 0 && (
        <p className="credit">
          Aucun contrat actif sur cette semaine pour ce foyer.
        </p>
      )}

      {data &&
        groupes.map((groupe) => (
          <div key={groupe.cle} style={{ marginTop: '0.75rem' }}>
            <h4 style={{ fontSize: 'var(--h2)', margin: '0 0 0.25rem' }}>
              {groupe.libelle}
            </h4>
            {groupe.contrats.map((contrat) => (
              <EditeurContratSemaine
                key={contrat.contratId}
                contrat={contrat}
                jours={data.jours}
                semaineIso={semaineIso}
                {...(onEnregistre ? { onEnregistre } : {})}
              />
            ))}
          </div>
        ))}
    </section>
  );
}
