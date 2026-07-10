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
import { EtatVide } from '../ui/EtatVide';
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

/** Explication du tiret « — » : le mois n'a pas (encore) de planning réel. */
const REEL_INDISPONIBLE = 'Pas encore de planning réel pour ce mois';

/**
 * Tiret « — » (réel indisponible) : explicité pour tout le monde — `title`
 * au survol pour la souris, texte `sr-only` équivalent pour les lecteurs
 * d'écran (le glyphe seul est masqué aux technologies d'assistance).
 */
function TiretReelIndisponible() {
  return (
    <span className="muted" title={REEL_INDISPONIBLE}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{REEL_INDISPONIBLE}</span>
    </span>
  );
}

/**
 * Valeur « Écart » (table ou carte mobile). Distingue le sens de l'écart
 * SANS reposer sur la couleur seule (UT-09 / WCAG 1.4.1) : préfixe signé `+`/`-`
 * conservé (CA1) + repère NON COLORÉ symbole/libellé (CA2), cas d'égalité inclus.
 * `delta === null` → tiret « — » (réel indisponible), sans repère.
 */
function ValeurDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <TiretReelIndisponible />;
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

/** Cellule « Écart » d'une ligne du tableau. */
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
 * téléphone → une carte par mois (Simulé / Réel / Écart) + carte de synthèse
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
          <dt>Simulé</dt>
          <dd>{centimesEnEuros(totalSimule)}</dd>
        </div>
        <div className="carte-cout-mois-ligne">
          <dt>Réel</dt>
          <dd>
            {totalReel !== null ? (
              centimesEnEuros(totalReel)
            ) : (
              <TiretReelIndisponible />
            )}
          </dd>
        </div>
        <div className="carte-cout-mois-ligne">
          <dt>Écart</dt>
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

  // Nouveau foyer (aucun contrat / aucun planning saisi) : douze lignes de
  // 0,00 € n'orientent personne → état vide avec un CTA vers les contrats.
  const aucunCout =
    etatSimule.data !== null &&
    etatSimule.data.totalCentimes === 0 &&
    etatSimule.data.mois.every((m) => m.prestations.length === 0);

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
        <h1 style={{ margin: 0 }}>Coûts annuels</h1>
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
        {/* Interrupteur simulation : même UI que le Planning, lié à ?simule
            (l'état survit au rechargement et se partage par URL). */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            margin: 0,
            fontSize: '0.9rem',
          }}
        >
          <input
            type="checkbox"
            checked={simule}
            onChange={(e) => {
              setParam({ simule: e.target.checked ? 'true' : null });
            }}
            style={{ width: 'auto', padding: 0 }}
          />
          Mode simulation
        </label>
        {simule && <Badge variante="simulation">Simulation</Badge>}
        <div
          className="actions-export no-print"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginLeft: 'auto',
          }}
        >
          {/* Rien à exporter/imprimer sur l'état vide : boutons masqués. */}
          {!aucunCout && (
            <>
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
            </>
          )}
          {id && (
            <Link
              // Cohérence aller-retour : le mode simulation suit vers le
              // planning (PlanningPage lit déjà ?simule).
              to={
                simule
                  ? `/foyers/${id}/planning?simule=true`
                  : `/foyers/${id}/planning`
              }
              className="btn secondaire"
            >
              Voir le détail du planning
            </Link>
          )}
        </div>
      </div>

      {simule && (
        <p className="muted" style={{ margin: '-0.5rem 0 1rem' }}>
          Comparez le coût du planning simulé au planning réel.
        </p>
      )}

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

      {/* État vide orienté action : le sélecteur d'année et l'interrupteur
          restent utilisables au-dessus (on peut changer d'année d'ici). */}
      {!loading && !error && aucunCout && (
        <EtatVide
          titre={`Aucun coût en ${annee}`}
          description="Les coûts apparaîtront dès qu'un contrat existe et qu'un planning est saisi."
          actions={[
            {
              libelle: 'Voir les contrats',
              href: `/foyers/${id}/contrats`,
              primaire: true,
            },
          ]}
        />
      )}

      {!loading && !error && etatSimule.data && !aucunCout && (
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
                    {simule ? 'Simulé' : 'Total'}
                  </th>
                  {simule && (
                    <>
                      <th
                        scope="col"
                        style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                      >
                        Réel
                      </th>
                      <th
                        scope="col"
                        style={{ padding: '0.6rem 1rem', textAlign: 'right' }}
                      >
                        Écart
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
                              <TiretReelIndisponible />
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
                          <TiretReelIndisponible />
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
