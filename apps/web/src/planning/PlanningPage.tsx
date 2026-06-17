import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useFoyer } from '../hooks/useFoyer';
import { useTitrePage } from '../hooks/useTitrePage';
import { useContrats } from '../foyer/useContrats';
import { moisCourant, formaterMoisFr } from '../utils/dates';
import { libelleMode } from '../utils/libelles';
import { Badge } from '../ui/Badge';
import { EtatVide } from '../ui/EtatVide';
import { PanneauCoutMois } from '../couts/PanneauCoutMois';
import { CalendrierCreche } from './CalendrierCreche';
import { CalendrierAbcm } from './CalendrierAbcm';
import type { ContratLocal } from '../types/bff';

export function PlanningPage() {
  useTitrePage('Planning');

  const { foyerId } = useParams<{ foyerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const simule = searchParams.get('simule') === 'true';

  // EX-06 : mois porté par l'URL (restauré au rechargement et au bouton retour).
  const mois = searchParams.get('mois') ?? moisCourant();

  // EX-06/CA2 : onglet enfant et mode actif portés par l'URL.
  const enfantParam = searchParams.get('enfant');
  const modeParam = searchParams.get('mode');

  // Version incrémentée après chaque écriture de planning réussie → rafraîchit
  // PanneauCoutMois (prop `version`, interface inchangée).
  const [planningVersion, setPlanningVersion] = useState(0);

  const id = foyerId ?? '';
  const { data: dossier, loading, error } = useFoyer(id);
  const { contrats, recharger: rechargerContrats } = useContrats(id);

  // Onglet enfant actif. Les contrats référencent l'enfant par son PRÉNOM
  // (CreerContrat.enfant) ; l'identité d'onglet est donc le prénom.
  const enfants = dossier?.enfants ?? [];
  const enfantSelectionne = enfantParam ?? enfants[0]?.prenom ?? null;

  // Contrats de l'enfant sélectionné
  const contratsEnfant: ContratLocal[] = contrats.filter(
    (c) => c.enfant === enfantSelectionne,
  );

  // Mode actif pour cet enfant. Par défaut (hors paramètre d'URL), on privilégie
  // le contrat **valide pour le mois affiché** plutôt que le premier de la liste :
  // sinon la page peut s'ouvrir sur un contrat futur/passé au calendrier vide
  // (ex. cantine ABCM démarrant en septembre alors qu'on affiche juin).
  const contratValidePourMois = contratsEnfant.find(
    (c) =>
      c.valideDu <= `${mois}-31` &&
      (c.valideAu === null || c.valideAu >= `${mois}-01`),
  );
  const modeSelectionne =
    modeParam ?? (contratValidePourMois ?? contratsEnfant[0])?.mode;

  const contratActif =
    contratsEnfant.find((c) => c.mode === modeSelectionne) ?? null;

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

  const handleMoisChange = (valeur: string) => {
    setParam({ mois: valeur });
  };

  const handleEnfantClick = (prenom: string) => {
    // Changer d'enfant invalide le mode sélectionné (propre à l'enfant précédent).
    setParam({ enfant: prenom, mode: null });
  };

  const handleModeClick = (mode: string) => {
    setParam({ mode });
  };

  const handleSimuleChange = (checked: boolean) => {
    setParam({ simule: checked ? 'true' : null });
  };

  const handleEnregistre = () => {
    setPlanningVersion((v) => v + 1);
  };

  // Modification durable du contrat (semaine type) : recharge la liste pour
  // refléter la nouvelle base et rafraîchit le coût (la cascade a réinitialisé
  // les saisies mensuelles côté serveur).
  const handleContratModifie = () => {
    rechargerContrats();
    setPlanningVersion((v) => v + 1);
  };

  // UT-01/CA2 : refs vers les boutons d'onglet pour gérer le focus au clavier
  // (roving tabindex). Une map par tablist (enfants, modes).
  const refsOngletsEnfants = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const refsOngletsModes = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * UT-01/CA2 : navigation clavier conforme au motif ARIA Tabs.
   * Flèches gauche/droite (avec bouclage), Home/End. L'activation déplace
   * le focus vers le nouvel onglet et le sélectionne.
   */
  const naviguerOnglets = (
    e: KeyboardEvent<HTMLButtonElement>,
    valeurs: string[],
    courant: string,
    refs: Record<string, HTMLButtonElement | null>,
    selectionner: (valeur: string) => void,
  ) => {
    const index = valeurs.indexOf(courant);
    if (index === -1) return;

    let cible: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        cible = (index + 1) % valeurs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        cible = (index - 1 + valeurs.length) % valeurs.length;
        break;
      case 'Home':
        cible = 0;
        break;
      case 'End':
        cible = valeurs.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const valeurCible = valeurs[cible];
    if (valeurCible === undefined) return;
    selectionner(valeurCible);
    refs[valeurCible]?.focus();
  };

  if (!id) {
    return <div className="carte muted">Aucun foyer sélectionné.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>
        Planning mensuel
      </h1>

      {/* Barre de contrôles */}
      <div
        className="carte"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1rem',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            margin: 0,
          }}
        >
          <span style={{ fontSize: '0.9rem' }}>Mois :</span>
          <input
            type="month"
            value={mois}
            onChange={(e) => handleMoisChange(e.target.value)}
            style={{ fontSize: '0.9rem' }}
          />
        </label>

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
            onChange={(e) => handleSimuleChange(e.target.checked)}
            style={{ width: 'auto', padding: 0 }}
          />
          Mode simulation
        </label>

        {simule && <Badge variante="simulation">SIMULATION</Badge>}
      </div>

      {/* États loading / error */}
      {loading && <div className="carte muted">Chargement du foyer...</div>}
      {error !== null && (
        <div className="carte" role="alert" style={{ color: 'var(--rouge)' }}>
          {error}
        </div>
      )}

      {!loading && error === null && (
        <div
          className="planning-zone"
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          {/* Zone principale */}
          <div style={{ flex: '1 1 0', minWidth: '0' }}>
            {/* EX-07 : état vide orienté action si ni enfant ni contrat */}
            {enfants.length === 0 && contrats.length === 0 && (
              <EtatVide
                titre="Aucun enfant ni contrat pour ce foyer"
                description="Créez un premier contrat pour commencer à planifier."
                actions={[
                  {
                    libelle: 'Créer un contrat',
                    href: `/foyers/${id}/contrats`,
                  },
                ]}
              />
            )}

            {enfants.length > 0 && (
              <>
                {/* Onglets par enfant (EX-10/CA4 + UT-01 motif ARIA complet) */}
                <div
                  className="onglets"
                  role="tablist"
                  aria-label="Enfants du foyer"
                >
                  {enfants.map((enfant) => {
                    const actif = enfantSelectionne === enfant.prenom;
                    return (
                      <button
                        key={enfant.id}
                        ref={(el) => {
                          refsOngletsEnfants.current[enfant.prenom] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`onglet-enfant-${enfant.prenom}`}
                        aria-controls={`panneau-enfant-${enfant.prenom}`}
                        aria-selected={actif}
                        tabIndex={actif ? 0 : -1}
                        className={actif ? 'onglet actif' : 'onglet'}
                        onClick={() => handleEnfantClick(enfant.prenom)}
                        onKeyDown={(e) =>
                          naviguerOnglets(
                            e,
                            enfants.map((en) => en.prenom),
                            enfant.prenom,
                            refsOngletsEnfants.current,
                            handleEnfantClick,
                          )
                        }
                      >
                        {enfant.prenom}
                      </button>
                    );
                  })}
                </div>

                {/* UT-01 : panneau de l'onglet enfant actif (tabpanel), relié
                    à l'onglet via aria-labelledby. */}
                {enfantSelectionne !== null && (
                  <div
                    role="tabpanel"
                    id={`panneau-enfant-${enfantSelectionne}`}
                    aria-labelledby={`onglet-enfant-${enfantSelectionne}`}
                  >
                    {/* Sous-onglets modes */}
                    {contratsEnfant.length === 0 && (
                      <EtatVide
                        titre="Aucun contrat pour cet enfant"
                        description="Ajoutez un contrat pour planifier les présences."
                        actions={[
                          {
                            libelle: 'Créer un contrat',
                            href: `/foyers/${id}/contrats`,
                          },
                        ]}
                      />
                    )}

                    {contratsEnfant.length > 0 && (
                      <>
                        <div
                          className="onglets"
                          role="tablist"
                          aria-label="Modes de garde"
                        >
                          {contratsEnfant.map((c) => {
                            const actif = modeSelectionne === c.mode;
                            return (
                              <button
                                key={c.id}
                                ref={(el) => {
                                  refsOngletsModes.current[c.mode] = el;
                                }}
                                type="button"
                                role="tab"
                                id={`onglet-mode-${c.mode}`}
                                aria-controls={`panneau-mode-${c.mode}`}
                                aria-selected={actif}
                                tabIndex={actif ? 0 : -1}
                                className={actif ? 'onglet actif' : 'onglet'}
                                onClick={() => handleModeClick(c.mode)}
                                onKeyDown={(e) =>
                                  naviguerOnglets(
                                    e,
                                    contratsEnfant.map((ce) => ce.mode),
                                    c.mode,
                                    refsOngletsModes.current,
                                    handleModeClick,
                                  )
                                }
                              >
                                {libelleMode(c.mode)}
                              </button>
                            );
                          })}
                        </div>

                        {/* Calendrier = panneau de l'onglet mode actif */}
                        <div
                          className="carte"
                          style={{ marginBottom: 0 }}
                          role="tabpanel"
                          id={
                            modeSelectionne
                              ? `panneau-mode-${modeSelectionne}`
                              : undefined
                          }
                          aria-labelledby={
                            modeSelectionne
                              ? `onglet-mode-${modeSelectionne}`
                              : undefined
                          }
                        >
                          <div
                            style={{
                              fontSize: '0.85rem',
                              color: 'var(--gris)',
                              marginBottom: '0.5rem',
                            }}
                          >
                            {formaterMoisFr(mois)}
                            {contratActif !== null && (
                              <span style={{ marginLeft: '0.5rem' }}>
                                — {libelleMode(contratActif.mode)}
                              </span>
                            )}
                          </div>

                          {contratActif !== null ? (
                            contratActif.mode === 'CRECHE_PSU' ? (
                              <CalendrierCreche
                                contrat={contratActif}
                                mois={mois}
                                simule={simule}
                                onEnregistre={handleEnregistre}
                                onContratModifie={handleContratModifie}
                              />
                            ) : (
                              <CalendrierAbcm
                                contrat={contratActif}
                                mois={mois}
                                simule={simule}
                                onEnregistre={handleEnregistre}
                                onContratModifie={handleContratModifie}
                              />
                            )
                          ) : (
                            <div className="muted">
                              Sélectionnez un contrat.
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Dossier chargé mais foyer sans enfants : on signale les contrats
                stockés localement. */}
            {enfants.length === 0 && contrats.length > 0 && (
              <div className="carte muted">
                Les contrats sont enregistrés localement mais le foyer ne
                contient pas d'enfants chargés.
              </div>
            )}
          </div>

          {/* Panneau coût du mois */}
          <div
            className="planning-panneau"
            style={{ width: '22rem', flexShrink: 0 }}
          >
            <PanneauCoutMois
              foyerId={id}
              mois={mois}
              simule={simule}
              version={planningVersion}
            />
          </div>
        </div>
      )}
    </div>
  );
}
