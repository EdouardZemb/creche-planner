import { useMemo, useState } from 'react';
import { jourCourantParis } from '@creche-planner/shared-semaine';
import { api } from '../api/client';
import type { ContratBesoinsSemaine, StatutNotification } from '../types/bff';
import { useAsync } from '../hooks/useAsync';
import { libelleSemaine } from '../utils/dates';
import { delaiPreavis } from '../planning/delaiPreavis';
import { EditeurContratSemaine } from './EditeurContratSemaine';
import { RelectureEnvoi } from './RelectureEnvoi';

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

  // Dès qu'un contrat est validé AVEC modifications, on propose la relecture/envoi des
  // récaps **agrégés par établissement** (Phase 4) — un seul mail par établissement.
  const [aEnvoyer, setAEnvoyer] = useState(false);
  const surValidation = (statut: StatutNotification): void => {
    if (statut === 'VALIDEE_AVEC_MODIFS') {
      setAEnvoyer(true);
    }
  };

  // Regroupe les contrats par établissement réel (lien explicite `etablissementId`,
  // P3), en conservant l'ordre des établissements concernés renvoyé par le BFF. Un
  // contrat non rattaché (`etablissementId` null) n'apparaît dans aucun groupe.
  const groupes = useMemo(() => {
    if (!data) return [];
    const parEtablissement = new Map<string, ContratBesoinsSemaine[]>();
    for (const c of data.contrats) {
      if (c.etablissementId === null) continue;
      const liste = parEtablissement.get(c.etablissementId) ?? [];
      liste.push(c);
      parEtablissement.set(c.etablissementId, liste);
    }
    return data.etablissements
      .map((etab) => ({
        id: etab.etablissementId,
        libelle: etab.libelle,
        preavisRegle: etab.preavisRegle,
        contrats: parEtablissement.get(etab.etablissementId) ?? [],
      }))
      .filter((g) => g.contrats.length > 0);
  }, [data]);

  // Date du jour normalisée Europe/Paris (convention métier, cf. `jourCourantParis`)
  // pour signaler un délai de préavis « peut-être dépassé ». Le calcul de la date
  // limite reste dans le module pur `delaiPreavis` (aucune horloge dans ce dernier).
  const aujourdhui = jourCourantParis(new Date());

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
        <p className="debit" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p className="muted">Chargement de la semaine…</p>}

      {data && groupes.length === 0 && (
        <p className="credit">
          Aucun contrat actif sur cette semaine pour cette famille.
        </p>
      )}

      {data &&
        groupes.map((groupe) => {
          // Date limite concrète du préavis pour la semaine notifiée (module pur).
          const delai = delaiPreavis(
            groupe.preavisRegle,
            semaineIso,
            aujourdhui,
          );
          return (
            <div key={groupe.id} style={{ marginTop: '0.75rem' }}>
              <h4 style={{ fontSize: 'var(--h2)', margin: '0 0 0.25rem' }}>
                {groupe.libelle}
              </h4>
              {delai !== null && (
                <p
                  className={`delai-preavis ${delai.depasse ? 'debit' : 'muted'}`}
                  {...(delai.depasse
                    ? { role: 'note', 'aria-live': 'polite' as const }
                    : {})}
                >
                  <span aria-hidden="true">🕒 </span>
                  {delai.texte}
                </p>
              )}
              {groupe.contrats.map((contrat) => (
                <EditeurContratSemaine
                  key={contrat.contratId}
                  contrat={contrat}
                  jours={data.jours}
                  semaineIso={semaineIso}
                  onValide={surValidation}
                  {...(onEnregistre ? { onEnregistre } : {})}
                />
              ))}
            </div>
          );
        })}

      {/* Récap au service **agrégé par établissement** (1 mail par établissement
          regroupant tous les enfants concernés du foyer), proposé après une
          validation avec modifications. */}
      {aEnvoyer && <RelectureEnvoi foyerId={foyerId} semaineIso={semaineIso} />}
    </section>
  );
}
