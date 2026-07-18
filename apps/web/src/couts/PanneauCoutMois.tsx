import { Fragment } from 'react';
import { api } from '../api/client';
import type { Ligne, PrestationCout } from '../types/bff';
import { centimesEnEuros, deltaEnEuros, repereDelta } from '../utils/money';
import { titrePrestationCout } from '../utils/libelles';
import { estSigleConnu } from '../utils/glossaire';
import { useAsync } from '../hooks/useAsync';
import { Spinner } from '../ui/Spinner';
import { Abbr } from '../ui/Abbr';
import { Badge } from '../ui/Badge';
import { coutMoisVersCsv, telechargerCsv, nomFichierCoutMois } from './export';

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

function LigneCout({
  ligne,
  avecSigne = true,
}: {
  ligne: Ligne;
  avecSigne?: boolean;
}) {
  const prefixe = ligne.sens === 'debit' ? '-' : '+';
  const classe = ligne.sens === 'debit' ? 'debit' : 'credit';
  return (
    <div className="ligne-cout">
      <span>{ligne.libelle}</span>
      <span className={classe}>
        {avecSigne ? prefixe : null}
        {centimesEnEuros(ligne.montantCentimes)}
      </span>
    </div>
  );
}

function SectionPrestation({ prestation }: { prestation: PrestationCout }) {
  return (
    <div className="section-prestation">
      {/* Titre en langage parent : « <enfant> — <mode accentué> », ou
          « Frais annuels — ABCM » pour la pseudo-prestation des frais fixes
          (jamais le code brut « FRAIS_FIXES_ABCM ») ; les sigles connus du
          glossaire (ABCM, ALSH…) restent explicités via Abbr. */}
      <div className="section-prestation-entete">
        <span>
          {avecSigles(titrePrestationCout(prestation.enfant, prestation.mode))}
        </span>
        <span>{centimesEnEuros(prestation.totalCentimes)}</span>
      </div>
      {prestation.lignes.map((l, i) => (
        <LigneCout key={i} ligne={l} avecSigne={false} />
      ))}
    </div>
  );
}

function RecapGlobal({ lignes }: { lignes: Ligne[] }) {
  if (lignes.length === 0) return null;
  return (
    <div className="recap-global">
      <div className="recap-global-titre">Total du mois</div>
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
  // Deux fetchs comme la page annuelle (`CoutsAnnuelsPage`) : le simulé est
  // toujours chargé, le réel seulement en mode simulation (comparaison). La
  // prop `version` reste le déclencheur de re-fetch après écriture de planning.
  const etatSimule = useAsync(
    (signal) => api.lireCoutMois(foyerId, mois, simule, { signal }),
    [foyerId, mois, simule, version],
  );

  const etatReel = useAsync(
    (signal) =>
      simule
        ? api.lireCoutMois(foyerId, mois, false, { signal })
        : Promise.resolve(null),
    [foyerId, mois, simule, version],
  );

  const loading = etatSimule.loading || etatReel.loading;
  const error = etatSimule.error ?? etatReel.error;
  const coutSimule = etatSimule.data;
  const coutReel = etatReel.data;

  if (loading) {
    return (
      <div className="carte muted" aria-live="polite">
        <Spinner />
        <span className="texte-spinner">Chargement du coût du mois…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="carte" role="alert">
        <p className="texte-erreur">{error}</p>
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
    );
  }

  if (!coutSimule) {
    return <div className="carte muted">Aucune donnée de coût disponible.</div>;
  }

  const deltaCentimes: number | null =
    simule && coutReel !== null
      ? coutSimule.totalCentimes - coutReel.totalCentimes
      : null;

  const exporterCsv = () => {
    telechargerCsv(nomFichierCoutMois(coutSimule), coutMoisVersCsv(coutSimule));
  };

  return (
    <div className="carte panneau-cout" id="recap-cout-mois">
      <div className="panneau-cout-entete">
        <h3 className="panneau-cout-titre">
          Coût du mois
          {simule ? (
            <span className="panneau-cout-badge">
              <Badge variante="simulation">Simulation</Badge>
            </span>
          ) : null}
        </h3>
        <div className="panneau-cout-total">
          <strong className="panneau-cout-montant">
            {centimesEnEuros(coutSimule.totalCentimes)}
          </strong>
          {deltaCentimes !== null &&
            (() => {
              const repere = repereDelta(deltaCentimes);
              return (
                <span
                  className="panneau-cout-delta"
                  style={
                    deltaCentimes < 0
                      ? { color: 'var(--vert)' }
                      : deltaCentimes > 0
                        ? { color: 'var(--rouge)' }
                        : undefined
                  }
                >
                  {/* Repère NON COLORÉ (UT-09 CA2) : symbole + libellé textuel,
                      pour ne pas reposer sur la couleur seule (cas d'égalité inclus). */}
                  <span aria-hidden="true" className="repere-delta">
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

      <div className="actions-export actions-export-panneau no-print">
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
          onClick={() => {
            window.print();
          }}
          aria-label="Imprimer ou enregistrer le coût du mois en PDF"
        >
          Imprimer / PDF
        </button>
      </div>
    </div>
  );
}
