import { useState, type CSSProperties } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { CoutAnnuelVue } from '../types/bff';
import { centimesEnEuros, deltaEnEuros, repereDelta } from '../utils/money';
import { formaterMoisFr } from '../utils/dates';
import { useAsync } from '../hooks/useAsync';
import { useTitrePage } from '../hooks/useTitrePage';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import {
  coutAnnuelVersCsv,
  telechargerCsv,
  nomFichierCoutAnnuel,
} from './export';

function anneeCourante(): number {
  return new Date().getFullYear();
}

interface LigneMois {
  mois: string;
  totalSimule: number;
  totalReel: number | null;
}

function construireLignes(
  simule: CoutAnnuelVue,
  reel: CoutAnnuelVue | null,
): LigneMois[] {
  return simule.mois.map((m) => {
    const moisReel = reel?.mois.find((r) => r.mois === m.mois) ?? null;
    return {
      mois: m.mois,
      totalSimule: m.totalCentimes,
      totalReel: moisReel !== null ? moisReel.totalCentimes : null,
    };
  });
}

/**
 * Cellule « Delta » d'une ligne du tableau. Distingue le sens de l'écart
 * SANS reposer sur la couleur seule (UT-09 / WCAG 1.4.1) : préfixe signé `+`/`-`
 * conservé (CA1) + repère NON COLORÉ symbole/libellé (CA2), cas d'égalité inclus.
 * `delta === null` → tiret « — » (réel indisponible), sans repère.
 */
function CelluleDelta({
  delta,
  style,
}: {
  delta: number | null;
  style: CSSProperties;
}) {
  if (delta === null) {
    return (
      <td style={style}>
        <span className="muted">—</span>
      </td>
    );
  }
  const repere = repereDelta(delta);
  return (
    <td
      style={{
        ...style,
        ...(delta < 0
          ? { color: 'var(--vert)' }
          : delta > 0
            ? { color: 'var(--rouge)' }
            : {}),
      }}
    >
      <span aria-hidden="true" style={{ marginRight: '0.25rem' }}>
        {repere.symbole}
      </span>
      {deltaEnEuros(delta)}
      <span className="sr-only"> ({repere.libelle})</span>
    </td>
  );
}

export function CoutsAnnuelsPage() {
  const { foyerId } = useParams<{ foyerId: string }>();
  const [searchParams] = useSearchParams();
  const simule = searchParams.get('simule') === 'true';

  const [annee, setAnnee] = useState<number>(anneeCourante());

  useTitrePage('Coûts annuels');

  const id = foyerId ?? '';

  const etatSimule = useAsync(
    (signal) => api.lireCoutAnnuel(id, annee, simule, { signal }),
    [id, annee, simule],
  );

  const etatReel = useAsync(
    (signal) =>
      simule
        ? api.lireCoutAnnuel(id, annee, false, { signal })
        : Promise.resolve(null),
    [id, annee, simule],
  );

  const loading = etatSimule.loading || etatReel.loading;
  const error = etatSimule.error ?? etatReel.error;

  const exporterCsv = () => {
    if (!etatSimule.data) return;
    telechargerCsv(
      nomFichierCoutAnnuel(etatSimule.data),
      coutAnnuelVersCsv(etatSimule.data, etatReel.data ?? null),
    );
  };

  return (
    <div id="recap-couts-annuels">
      <div
        className="barre-couts-annuels"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>
          Coûts annuels
          {simule && (
            <span style={{ marginLeft: '0.75rem', verticalAlign: 'middle' }}>
              <Badge variante="simulation">SIMULATION</Badge>
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label htmlFor="annee-select" style={{ margin: 0 }}>
            Année :
          </label>
          <input
            id="annee-select"
            type="number"
            value={annee}
            min={2020}
            max={2099}
            style={{ width: '5rem' }}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) setAnnee(v);
            }}
          />
        </div>
        <div
          className="actions-export no-print"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginLeft: 'auto',
          }}
        >
          <button
            type="button"
            className="btn secondaire"
            onClick={exporterCsv}
            disabled={!etatSimule.data}
            aria-label="Exporter les coûts annuels au format CSV"
          >
            Exporter CSV
          </button>
          <button
            type="button"
            className="btn secondaire"
            onClick={() => window.print()}
            aria-label="Imprimer ou enregistrer les coûts annuels en PDF"
          >
            Imprimer / PDF
          </button>
          {id && (
            <Link to={`/foyers/${id}/planning`} className="btn secondaire">
              Voir le détail du planning
            </Link>
          )}
        </div>
      </div>

      {loading && (
        <div className="carte muted" aria-live="polite">
          <Spinner />
          <span style={{ marginLeft: '0.5rem' }}>
            Chargement des coûts annuels…
          </span>
        </div>
      )}

      {!loading && error && (
        <div className="carte" role="alert">
          <p style={{ color: 'var(--rouge)', margin: '0 0 0.5rem' }}>{error}</p>
          <button
            type="button"
            className="btn secondaire no-print"
            onClick={() => {
              etatSimule.reload();
              etatReel.reload();
            }}
          >
            Réessayer
          </button>
        </div>
      )}

      {!loading && !error && etatSimule.data && (
        <div className="carte table-couts-wrap" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
              }}
            >
              Coûts mensuels {simule ? 'simulés' : ''} pour l&apos;année {annee}
            </caption>
            <thead>
              <tr
                style={{ background: 'var(--gris-clair)', textAlign: 'left' }}
              >
                <th scope="col" style={{ padding: '0.6rem 1rem' }}>
                  Mois
                </th>
                <th
                  scope="col"
                  style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                >
                  {simule ? 'Total simulé' : 'Total'}
                </th>
                {simule && (
                  <>
                    <th
                      scope="col"
                      style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                    >
                      Total réel
                    </th>
                    <th
                      scope="col"
                      style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                    >
                      Delta
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {construireLignes(etatSimule.data, etatReel.data ?? null).map(
                (ligne) => {
                  const delta =
                    simule && ligne.totalReel !== null
                      ? ligne.totalSimule - ligne.totalReel
                      : null;
                  return (
                    <tr
                      key={ligne.mois}
                      style={{ borderTop: '1px solid var(--bordure)' }}
                    >
                      <th
                        scope="row"
                        style={{
                          padding: '0.5rem 1rem',
                          textAlign: 'left',
                          fontWeight: 'normal',
                        }}
                      >
                        {formaterMoisFr(ligne.mois)}
                      </th>
                      <td
                        style={{ padding: '0.5rem 1rem', textAlign: 'right' }}
                      >
                        {centimesEnEuros(ligne.totalSimule)}
                      </td>
                      {simule && (
                        <>
                          <td
                            style={{
                              padding: '0.5rem 1rem',
                              textAlign: 'right',
                            }}
                          >
                            {ligne.totalReel !== null ? (
                              centimesEnEuros(ligne.totalReel)
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <CelluleDelta
                            delta={delta}
                            style={{
                              padding: '0.5rem 1rem',
                              textAlign: 'right',
                            }}
                          />
                        </>
                      )}
                    </tr>
                  );
                },
              )}
            </tbody>
            <tfoot>
              <tr
                style={{
                  borderTop: '2px solid var(--bordure)',
                  fontWeight: 700,
                  background: 'var(--gris-clair)',
                }}
              >
                <th scope="row" style={{ padding: '0.6rem 1rem' }}>
                  Total annuel
                </th>
                <td style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                  {centimesEnEuros(etatSimule.data.totalCentimes)}
                </td>
                {simule && (
                  <>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                      {etatReel.data !== null ? (
                        centimesEnEuros(etatReel.data.totalCentimes)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <CelluleDelta
                      delta={
                        etatReel.data !== null
                          ? etatSimule.data.totalCentimes -
                            etatReel.data.totalCentimes
                          : null
                      }
                      style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                    />
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && !error && !etatSimule.data && (
        <div className="carte muted">
          Aucun coût disponible pour cette année.
        </div>
      )}
    </div>
  );
}
