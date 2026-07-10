import { type CSSProperties } from 'react';
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

/** Bornes de navigation d'année (◀/▶ désactivés aux extrémités). */
const ANNEE_MIN = 2020;
const ANNEE_MAX = 2099;

function anneeCourante(): number {
  return new Date().getFullYear();
}

/**
 * Lit l'année depuis `?annee=YYYY` (partageable par URL). Absente, non
 * numérique ou hors bornes → année courante, sans crash.
 */
function lireAnnee(searchParams: URLSearchParams): number {
  const brut = searchParams.get('annee');
  if (brut === null) return anneeCourante();
  const valeur = Number.parseInt(brut, 10);
  if (Number.isNaN(valeur) || valeur < ANNEE_MIN || valeur > ANNEE_MAX) {
    return anneeCourante();
  }
  return valeur;
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
 * Valeur « Delta » (table ou carte mobile). Distingue le sens de l'écart
 * SANS reposer sur la couleur seule (UT-09 / WCAG 1.4.1) : préfixe signé `+`/`-`
 * conservé (CA1) + repère NON COLORÉ symbole/libellé (CA2), cas d'égalité inclus.
 * `delta === null` → tiret « — » (réel indisponible), sans repère.
 */
function ValeurDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="muted">—</span>;
  }
  const repere = repereDelta(delta);
  return (
    <span className={delta < 0 ? 'credit' : delta > 0 ? 'debit' : undefined}>
      <span aria-hidden="true" className="repere-delta">
        {repere.symbole}
      </span>
      {deltaEnEuros(delta)}
      <span className="sr-only"> ({repere.libelle})</span>
    </span>
  );
}

/** Cellule « Delta » d'une ligne du tableau. */
function CelluleDelta({
  delta,
  style,
}: {
  delta: number | null;
  style: CSSProperties;
}) {
  return (
    <td style={style}>
      <ValeurDelta delta={delta} />
    </td>
  );
}

/**
 * Vue simulation sous 768px : la table 4 colonnes ne tient pas sur un
 * téléphone → une carte par mois (Simulé / Réel / Delta) + carte de synthèse
 * « Total annuel ». Mêmes données que la table desktop (`construireLignes`),
 * bascule d'affichage en CSS (`.liste-couts-mobile` / `.table-couts-desktop`).
 */
function ListeCoutsMobile({
  lignes,
  totalSimule,
  totalReel,
}: {
  lignes: readonly LigneMois[];
  totalSimule: number;
  totalReel: number | null;
}) {
  return (
    <div className="liste-couts-mobile">
      {lignes.map((ligne) => (
        <CarteCoutMois
          key={ligne.mois}
          titre={formaterMoisFr(ligne.mois)}
          totalSimule={ligne.totalSimule}
          totalReel={ligne.totalReel}
        />
      ))}
      <CarteCoutMois
        titre="Total annuel"
        totalSimule={totalSimule}
        totalReel={totalReel}
        synthese
      />
    </div>
  );
}

function CarteCoutMois({
  titre,
  totalSimule,
  totalReel,
  synthese = false,
}: {
  titre: string;
  totalSimule: number;
  totalReel: number | null;
  synthese?: boolean;
}) {
  const delta = totalReel !== null ? totalSimule - totalReel : null;
  return (
    <div
      className={
        synthese
          ? 'carte carte-cout-mois carte-cout-total'
          : 'carte carte-cout-mois'
      }
    >
      <h2 className="carte-cout-mois-titre">{titre}</h2>
      <dl className="carte-cout-mois-lignes">
        <div className="carte-cout-mois-ligne">
          <dt>Total simulé</dt>
          <dd>{centimesEnEuros(totalSimule)}</dd>
        </div>
        <div className="carte-cout-mois-ligne">
          <dt>Total réel</dt>
          <dd>
            {totalReel !== null ? (
              centimesEnEuros(totalReel)
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
        </div>
        <div className="carte-cout-mois-ligne">
          <dt>Delta</dt>
          <dd>
            <ValeurDelta delta={delta} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function CoutsAnnuelsPage() {
  const { foyerId } = useParams<{ foyerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const simule = searchParams.get('simule') === 'true';
  const annee = lireAnnee(searchParams);

  useTitrePage('Coûts annuels');

  const id = foyerId ?? '';

  /** Met à jour un paramètre d'URL (supprime la clé si valeur nulle). */
  const setParam = (cles: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [cle, valeur] of Object.entries(cles)) {
      if (valeur === null) {
        next.delete(cle);
      } else {
        next.set(cle, valeur);
      }
    }
    setSearchParams(next);
  };

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

  const lignes = etatSimule.data
    ? construireLignes(etatSimule.data, etatReel.data ?? null)
    : [];

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
        <div className="selecteur-annee">
          <button
            type="button"
            className="btn secondaire"
            aria-label="Année précédente"
            disabled={annee <= ANNEE_MIN}
            onClick={() => {
              setParam({ annee: String(annee - 1) });
            }}
          >
            ◀
          </button>
          <span className="selecteur-annee-valeur" aria-live="polite">
            {annee}
          </span>
          <button
            type="button"
            className="btn secondaire"
            aria-label="Année suivante"
            disabled={annee >= ANNEE_MAX}
            onClick={() => {
              setParam({ annee: String(annee + 1) });
            }}
          >
            ▶
          </button>
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
            onClick={() => {
              window.print();
            }}
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
        <>
          <div
            className={
              simule
                ? 'carte table-couts-wrap table-couts-desktop'
                : 'carte table-couts-wrap'
            }
            style={{ padding: 0 }}
          >
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
                Coûts mensuels {simule ? 'simulés' : ''} pour l&apos;année{' '}
                {annee}
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
                {lignes.map((ligne) => {
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
                })}
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
                      <td
                        style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                      >
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
          {simule && (
            <ListeCoutsMobile
              lignes={lignes}
              totalSimule={etatSimule.data.totalCentimes}
              totalReel={
                etatReel.data !== null ? etatReel.data.totalCentimes : null
              }
            />
          )}
        </>
      )}

      {!loading && !error && !etatSimule.data && (
        <div className="carte muted">
          Aucun coût disponible pour cette année.
        </div>
      )}
    </div>
  );
}
