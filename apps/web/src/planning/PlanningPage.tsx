import { lazy, Suspense, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useFoyer } from '../hooks/useFoyer';
import { useTitrePage } from '../hooks/useTitrePage';
import { useContrats } from '../foyer/useContrats';
import { moisCourant, formaterMoisFr } from '../utils/dates';
import { libelleMode } from '../utils/libelles';
import {
  etatContrat,
  libelleEtatContrat,
  moisUtile,
  resoudreContratAffiche,
} from './etatContrat';
import { Badge } from '../ui/Badge';
import { Bouton } from '../ui/Bouton';
import { EtatVide } from '../ui/EtatVide';
import { ChargementPage } from '../ui/ChargementPage';
import { FrontiereErreur } from '../layout/FrontiereErreur';
import { ChunkEnErreur } from '../layout/EcransRecuperation';
import { PanneauCoutMois } from '../couts/PanneauCoutMois';
import { EncartValidation } from '../notifications/EncartValidation';
import type { ContratLocal } from '../types/bff';

// E1 (bundle) : les calendriers embarquent FullCalendar (~lourd). Chargés à la
// demande (`lazy`) pour les sortir du bundle initial (le dashboard n'en a pas
// besoin) ; leur rendu est enveloppé dans un `<Suspense>` plus bas.
const CalendrierCreche = lazy(() =>
  import('./CalendrierCreche').then((m) => ({ default: m.CalendrierCreche })),
);
const CalendrierAbcm = lazy(() =>
  import('./CalendrierAbcm').then((m) => ({ default: m.CalendrierAbcm })),
);

/** Forme d'une semaine ISO 8601 (`YYYY-Www`) acceptée dans `?semaine`. */
const SEMAINE_ISO_REGEX = /^\d{4}-W\d{2}$/;

export function PlanningPage() {
  useTitrePage('Planning');

  const { foyerId } = useParams<{ foyerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const simule = searchParams.get('simule') === 'true';

  // Lien profond du mail/de la cloche du mardi (`?semaine=YYYY-Www`) : ouvre d'office
  // l'éditeur de cette semaine dans l'encart de validation. Paramètre malformé → ignoré
  // silencieusement (rejet par la regex), sans écraser les autres paramètres d'URL.
  const semaineParam = searchParams.get('semaine');
  const semaineInitiale =
    semaineParam !== null && SEMAINE_ISO_REGEX.test(semaineParam)
      ? semaineParam
      : undefined;

  // EX-06 : mois porté par l'URL (restauré au rechargement et au bouton retour).
  const mois = searchParams.get('mois') ?? moisCourant();

  // EX-06/CA2 : onglet enfant et contrat actif portés par l'URL. `?contrat=<id>`
  // désigne un contrat PRÉCIS ; `?mode=` reste lu pour ne pas casser les liens
  // profonds déjà émis (dashboard, mail du mardi), mais il ne sait pas départager
  // deux contrats de même mode — c'est exactement le défaut corrigé ici.
  const enfantParam = searchParams.get('enfant');
  const contratParam = searchParams.get('contrat');
  const modeParam = searchParams.get('mode');

  // Version incrémentée après chaque écriture de planning réussie → rafraîchit
  // PanneauCoutMois (prop `version`, interface inchangée).
  const [planningVersion, setPlanningVersion] = useState(0);

  const id = foyerId ?? '';
  const { data: dossier, loading, error } = useFoyer(id);
  const { contrats, recharger: rechargerContrats } = useContrats(id);

  // Onglet enfant actif, identifié par le PRÉNOM (lisible dans l'URL `?enfant=`).
  // Le contrat référence l'enfant par `enfantId` mais porte le prénom en
  // dénormalisation d'affichage, rafraîchie au renommage (projection NATS) :
  // le filtre par prénom ci-dessous reste donc cohérent avec le dossier foyer.
  const enfants = dossier?.enfants ?? [];
  const enfantSelectionne = enfantParam ?? enfants[0]?.prenom ?? null;

  // Contrats de l'enfant sélectionné
  const contratsEnfant: ContratLocal[] = contrats.filter(
    (c) => c.enfant === enfantSelectionne,
  );

  // Contrat affiché : identité de l'onglet, PLUS le mode (cf. `etatContrat.ts`).
  const contratActif = resoudreContratAffiche(
    contratsEnfant,
    mois,
    contratParam,
    modeParam,
  );

  // Mois où le contrat affiché a quelque chose à saisir, quand ce n'est pas celui
  // qu'on regarde. C'est le cas de la rentrée : en août, ni le contrat qui s'est
  // achevé en juillet ni celui qui commence en septembre n'ont un seul jour à
  // montrer — et l'écran ne le disait pas.
  const moisASaisir = contratActif ? moisUtile(contratActif, mois) : null;

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

  const handleContratClick = (contratId: string) => {
    // On pose `?contrat=` ET on retire `?mode=` : laisser l'ancien paramètre
    // derrière soi rouvrirait le premier contrat du mode au rechargement.
    setParam({ contrat: contratId, mode: null });
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
  const refsOngletsContrats = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );

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
    return <div className="carte muted">Aucune famille sélectionnée.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>
        Planning mensuel
      </h1>

      {/* Encart de validation hebdomadaire (Lot 4) : ne s'affiche que s'il y a une
          semaine à valider pour ce foyer. `semaineInitiale` (lien profond du mardi)
          ouvre d'office l'éditeur de la semaine concernée. */}
      <EncartValidation foyerId={id} semaineInitiale={semaineInitiale} />

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
          {/* Pas de fontSize réduit ici : iOS zoome au focus d'un champ < 16px
              (la taille vient du style global input/select). */}
          <input
            type="month"
            value={mois}
            onChange={(e) => {
              handleMoisChange(e.target.value);
            }}
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
            onChange={(e) => {
              handleSimuleChange(e.target.checked);
            }}
          />
          Mode simulation
        </label>

        {simule && <Badge variante="simulation">Simulation</Badge>}
      </div>

      {simule && (
        <p className="muted aide-simulation">
          Le mode simulation vous laisse essayer des changements sans toucher au
          planning réel ni aux récapitulatifs envoyés.
        </p>
      )}

      {/* États loading / error */}
      {loading && <ChargementPage message="Chargement de votre famille…" />}
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
          {/* Zone principale.
              `maxWidth: 100%` borne la colonne à la largeur du conteneur : sur
              mobile, FullCalendar peut surcalculer sa largeur après une saisie
              (ex. première absence crèche) et, sans borne, étirer cette colonne
              au-delà du viewport → débordement horizontal de toute la page.
              `minWidth: 0` autorise la colonne flex à se rétrécir sous la
              largeur intrinsèque de son contenu. */}
          <div style={{ flex: '1 1 0', minWidth: '0', maxWidth: '100%' }}>
            {/* EX-07 : état vide orienté action si ni enfant ni contrat */}
            {enfants.length === 0 && contrats.length === 0 && (
              <EtatVide
                titre="Aucun enfant ni contrat pour cette famille"
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
                  aria-label="Enfants de la famille"
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
                        onClick={() => {
                          handleEnfantClick(enfant.prenom);
                        }}
                        onKeyDown={(e) => {
                          naviguerOnglets(
                            e,
                            enfants.map((en) => en.prenom),
                            enfant.prenom,
                            refsOngletsEnfants.current,
                            handleEnfantClick,
                          );
                        }}
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
                            const actif = contratActif?.id === c.id;
                            const periode = libelleEtatContrat(c, mois);
                            const enCours = etatContrat(c, mois) === 'en-cours';
                            return (
                              <button
                                key={c.id}
                                ref={(el) => {
                                  refsOngletsContrats.current[c.id] = el;
                                }}
                                type="button"
                                role="tab"
                                id={`onglet-contrat-${c.id}`}
                                aria-controls={`panneau-contrat-${c.id}`}
                                aria-selected={actif}
                                tabIndex={actif ? 0 : -1}
                                className={`onglet onglet-contrat${
                                  actif ? ' actif' : ''
                                }${enCours ? '' : ' onglet-hors-periode'}`}
                                // Le nom accessible porte l'identité COMPLÈTE :
                                // deux contrats crèche se lisent « Crèche,
                                // terminé le 24/07/2026 » et « Crèche, à partir
                                // du 01/09/2026 ». Le seul libellé de mode les
                                // rendait indiscernables, à l'œil comme au
                                // lecteur d'écran.
                                aria-label={`${libelleMode(c.mode)}, ${periode}`}
                                onClick={() => {
                                  handleContratClick(c.id);
                                }}
                                onKeyDown={(e) => {
                                  naviguerOnglets(
                                    e,
                                    contratsEnfant.map((ce) => ce.id),
                                    c.id,
                                    refsOngletsContrats.current,
                                    handleContratClick,
                                  );
                                }}
                              >
                                <span>{libelleMode(c.mode)}</span>
                                <span className="onglet-periode">
                                  {periode}
                                </span>
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
                            contratActif
                              ? `panneau-contrat-${contratActif.id}`
                              : undefined
                          }
                          aria-labelledby={
                            contratActif
                              ? `onglet-contrat-${contratActif.id}`
                              : undefined
                          }
                        >
                          <div
                            className="mb-2"
                            style={{
                              fontSize: '0.85rem',
                              color: 'var(--gris)',
                            }}
                          >
                            {formaterMoisFr(mois)}
                            {contratActif !== null && (
                              <span style={{ marginLeft: '0.5rem' }}>
                                — {libelleMode(contratActif.mode)}
                              </span>
                            )}
                          </div>

                          {contratActif !== null && moisASaisir !== null ? (
                            // Le mois affiché ne contient AUCUN jour du contrat :
                            // le calendrier serait vide et chaque clic serait
                            // avalé en silence (`estDansPeriode` refuse le jour
                            // sans rien dire). C'est ce qui s'est passé en août
                            // 2026 : le contrat précédent s'était achevé le 24/07,
                            // celui de la rentrée commençait le 01/09, et l'écran
                            // ne donnait AUCUNE explication. On le dit, et on
                            // propose le mois où il y a effectivement à saisir.
                            <div className="etat-hors-periode">
                              <p className="mt-0">
                                {`Ce contrat ne couvre aucun jour de ${formaterMoisFr(mois)} : `}
                                {libelleEtatContrat(contratActif, mois)}
                                {'.'}
                              </p>
                              <Bouton
                                onClick={() => {
                                  handleMoisChange(moisASaisir);
                                }}
                              >
                                {`Afficher ${formaterMoisFr(moisASaisir)}`}
                              </Bouton>
                            </div>
                          ) : contratActif !== null ? (
                            // C7 : frontière autour du `<Suspense>`. Un chunk
                            // `lazy()` qui n'arrive pas (réseau coupé, fichier
                            // disparu après un déploiement) est un mode de
                            // défaillance DISTINCT d'une exception de rendu, et
                            // le seul que `<Suspense>` ne couvre pas : son
                            // `fallback` sert l'attente, pas l'échec. Réarmée au
                            // changement de contrat pour ne pas coller à l'écran.
                            <FrontiereErreur
                              origine="chunk"
                              clesReinitialisation={[contratActif.id]}
                              rendu={() => (
                                <ChunkEnErreur quoi="Le calendrier" />
                              )}
                            >
                              <Suspense
                                fallback={
                                  <ChargementPage message="Chargement du calendrier…" />
                                }
                              >
                                {contratActif.mode === 'CRECHE_PSU' ? (
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
                                )}
                              </Suspense>
                            </FrontiereErreur>
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
                Les contrats sont enregistrés localement mais la famille ne
                contient pas d’enfants chargés.
              </div>
            )}
          </div>

          {/* Panneau coût du mois (largeur responsive gérée par .planning-panneau).
              Même borne que la zone principale : aucun enfant de `.planning-zone`
              ne doit pouvoir pousser la page au-delà de sa largeur. */}
          <div className="planning-panneau" style={{ maxWidth: '100%' }}>
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
