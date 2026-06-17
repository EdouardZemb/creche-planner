import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CoutMoisVue, Ligne, Mode, PrestationCout } from '../types/bff';
import { centimesEnEuros, deltaEnEuros, repereDelta } from '../utils/money';
import { LIBELLES_MODE } from '../utils/libelles';
import { estSigleConnu } from '../utils/glossaire';
import { messageErreur } from '../utils/erreurs';
import { Spinner } from '../ui/Spinner';
import { Abbr } from '../ui/Abbr';
import { Badge } from '../ui/Badge';
import { coutMoisVersCsv, telechargerCsv, nomFichierCoutMois } from './export';

/** Libellé accentué du mode (jamais le code brut « CRECHE_PSU »). */
function libelleMode(mode: string): string {
  return LIBELLES_MODE[mode as Mode] ?? mode;
}

/**
 * Rend un libellé en explicitant ses sigles métier (UT-08) : chaque token connu
 * du glossaire (PSU, ALSH…) est enveloppé dans `Abbr` (nom accessible + tooltip
 * clavier). Réutilise `glossaire.ts` — aucun libellé dupliqué ici.
 */
function avecSigles(texte: string) {
  return texte
    .split(/(\s+)/)
    .map((token, i) =>
      estSigleConnu(token) ? (
        <Abbr key={i} sigle={token} />
      ) : (
        <Fragment key={i}>{token}</Fragment>
      ),
    );
}

// Interface verrouillée au scaffold : PlanningPage (agent Planning) rend ce
// panneau ; l'implémentation (agent Coûts) lit GET /api/v1/couts et affiche le
// détail + le delta de simulation. Ne pas changer la signature des props sans
// coordination.
export interface PanneauCoutMoisProps {
  foyerId: string;
  mois: string;
  simule: boolean;
  /** Incrémenté après chaque écriture de planning → force le re-fetch du coût. */
  version?: number;
}

function LigneCout({ ligne }: { ligne: Ligne }) {
  const prefixe = ligne.sens === 'debit' ? '-' : '+';
  const classe = ligne.sens === 'debit' ? 'debit' : 'credit';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0.2rem 0',
      }}
    >
      <span>{ligne.libelle}</span>
      <span className={classe}>
        {prefixe}
        {centimesEnEuros(ligne.montantCentimes)}
      </span>
    </div>
  );
}

function SectionPrestation({ prestation }: { prestation: PrestationCout }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 600,
          marginBottom: '0.25rem',
        }}
      >
        <span>
          {prestation.enfant} — {avecSigles(libelleMode(prestation.mode))}
        </span>
        <span>{centimesEnEuros(prestation.totalCentimes)}</span>
      </div>
      {prestation.lignes.map((l, i) => (
        <LigneCout key={i} ligne={l} />
      ))}
    </div>
  );
}

function RecapGlobal({ lignes }: { lignes: Ligne[] }) {
  if (lignes.length === 0) return null;
  return (
    <div
      style={{
        borderTop: '1px solid #e5e7eb',
        paddingTop: '0.5rem',
        marginTop: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        Récapitulatif
      </div>
      {lignes.map((l, i) => (
        <LigneCout key={i} ligne={l} />
      ))}
    </div>
  );
}

export function PanneauCoutMois({
  foyerId,
  mois,
  simule,
  version,
}: PanneauCoutMoisProps) {
  const [coutSimule, setCoutSimule] = useState<CoutMoisVue | null>(null);
  const [coutReel, setCoutReel] = useState<CoutMoisVue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    const fetchSimule = api.lireCoutMois(foyerId, mois, simule, {
      signal: ctrl.signal,
    });
    const fetchReel = simule
      ? api.lireCoutMois(foyerId, mois, false, { signal: ctrl.signal })
      : Promise.resolve(null);

    Promise.all([fetchSimule, fetchReel])
      .then(([sim, reel]) => {
        if (ctrl.signal.aborted) return;
        setCoutSimule(sim);
        setCoutReel(reel);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(messageErreur(e));
        setLoading(false);
      });

    return () => ctrl.abort();
  }, [foyerId, mois, simule, version]);

  if (loading) {
    return (
      <div className="carte muted" aria-live="polite">
        <Spinner />
        <span style={{ marginLeft: '0.5rem' }}>
          Chargement du coût du mois…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="carte" role="alert" style={{ color: 'var(--rouge)' }}>
        {error}
      </div>
    );
  }

  if (!coutSimule) {
    return <div className="carte muted">Aucune donnée de coût disponible.</div>;
  }

  const deltaCentimes =
    simule && coutReel !== null
      ? coutSimule.totalCentimes - coutReel.totalCentimes
      : null;

  const exporterCsv = () => {
    telechargerCsv(nomFichierCoutMois(coutSimule), coutMoisVersCsv(coutSimule));
  };

  return (
    <div className="carte panneau-cout" id="recap-cout-mois">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1rem' }}>
          Coût du mois
          {simule ? (
            <span style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }}>
              <Badge variante="simulation">Simulation</Badge>
            </span>
          ) : null}
        </h3>
        <div
          style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}
        >
          <strong style={{ fontSize: '1.1rem' }}>
            {centimesEnEuros(coutSimule.totalCentimes)}
          </strong>
          {deltaCentimes !== null &&
            (() => {
              const repere = repereDelta(deltaCentimes);
              return (
                <span
                  style={{
                    fontSize: '0.9rem',
                    ...(deltaCentimes < 0
                      ? { color: 'var(--vert)' }
                      : deltaCentimes > 0
                        ? { color: 'var(--rouge)' }
                        : {}),
                    fontWeight: 500,
                  }}
                >
                  {/* Repère NON COLORÉ (UT-09 CA2) : symbole + libellé textuel,
                      pour ne pas reposer sur la couleur seule (cas d'égalité inclus). */}
                  <span aria-hidden="true" style={{ marginRight: '0.25rem' }}>
                    {repere.symbole}
                  </span>
                  {deltaEnEuros(deltaCentimes)}
                  <span className="sr-only"> ({repere.libelle})</span>
                </span>
              );
            })()}
        </div>
      </div>

      {coutSimule.prestations.length > 0 ? (
        coutSimule.prestations.map((p) => (
          <SectionPrestation key={`${p.enfant}__${p.mode}`} prestation={p} />
        ))
      ) : (
        <p className="muted">Aucune prestation ce mois-ci.</p>
      )}

      <RecapGlobal lignes={coutSimule.lignes} />

      <div
        className="actions-export no-print"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginTop: '0.75rem',
        }}
      >
        <button
          type="button"
          className="btn secondaire"
          onClick={exporterCsv}
          aria-label="Exporter le coût du mois au format CSV"
        >
          Exporter CSV
        </button>
        <button
          type="button"
          className="btn secondaire"
          onClick={() => window.print()}
          aria-label="Imprimer ou enregistrer le coût du mois en PDF"
        >
          Imprimer / PDF
        </button>
      </div>
    </div>
  );
}
