import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import {
  coherenceHeuresAnnuelles,
  heuresMaximalesSurPeriode,
  messageCoherenceHeures,
} from '@creche-planner/shared-semaine';
import { api, ApiError } from '../api/client';
import type {
  EnfantVue,
  ContratLocal,
  Mode,
  JourSemaine,
  PlageHoraire,
  SemaineAbcm,
  EtablissementFoyerVue,
  LienEtablissementSaisie,
} from '../types/bff';
import {
  JOURS_SEMAINE_OUVRES,
  PlageEditor,
  AbcmEditor,
  AlshHebdoEditor,
  cochesDepuisSemaine,
  plagesDepuisSemaine,
  abcmDepuisSemaine,
  construireSemaineType,
  construireSemaineAbcmComplete,
} from './editeursSemaine';
import {
  extraireErreurs,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { LIBELLES_MODE, estMode } from '../utils/libelles';
import { Abbr } from '../ui/Abbr';
import { Bouton } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';
import { ChampFormulaire } from '../ui/ChampFormulaire';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';

const MODES_SELECTIONNABLES: Mode[] = [
  'CRECHE_PSU',
  'CANTINE',
  'PERISCOLAIRE',
  'ALSH',
];

// Champs dont l'erreur est affichée inline et liée au contrôle (aria-describedby).
// Les autres erreurs de champ remontent en haut du formulaire.
const CHAMPS_LIES = new Set<string>([
  'mode',
  'enfant',
  'valideDu',
  'valideAu',
  'heuresAnnuellesContractualisees',
  'nbMensualites',
  'etablissementId',
  'nouvelEtablissementNom',
]);

// ---- ContratForm -------------------------------------------------------------

/** Valeur sentinelle du sélecteur d'établissement : « créer à la volée ». */
const NOUVEL_ETABLISSEMENT = '__nouveau__';

/**
 * Plage proposée pour un jour gardé dont l'horaire n'a pas été précisé. Elle était
 * jusqu'ici écrite en clair dans le rendu, ce qui la rendait **purement
 * décorative** : `plagesJours` n'était renseigné qu'à la première modification
 * d'un champ horaire, si bien qu'un jour coché — y compris les quatre jours
 * cochés par défaut à l'ouverture du formulaire — partait avec une liste de
 * plages VIDE. Un contrat créé sans toucher aux horaires n'avait donc aucune
 * semaine type, et ses heures annuelles ne correspondaient à rien.
 */
const PLAGE_DEFAUT: PlageHoraire = {
  debutHeures: 8,
  debutMinutes: 0,
  finHeures: 17,
  finMinutes: 30,
};

export interface ContratFormProps {
  foyerId: string;
  enfants: EnfantVue[];
  /**
   * Établissements (entité libre) du foyer, pour le sélecteur de rattachement.
   * Passés en prop par la page (qui les charge) — le formulaire reste un contrôlé
   * pur, sans fetch propre. Absent/défaut ⇒ seule l'option « créer à la volée »
   * est offerte.
   */
  etablissements?: EtablissementFoyerVue[];
  /** Contrat à éditer ; absent ⇒ mode création. */
  contrat?: ContratLocal;
  /** Callback de succès (création OU modification). */
  onCree: (c: ContratLocal) => void;
  onAnnuler?: () => void;
}

export function ContratForm({
  foyerId,
  enfants,
  etablissements = [],
  contrat,
  onCree,
  onAnnuler,
}: ContratFormProps) {
  const edition = contrat !== undefined;
  const idBase = useId();

  // Rattachement à un établissement : id existant, '' (aucun), ou la sentinelle
  // NOUVEL_ETABLISSEMENT (création à la volée → champs nom/e-mail dédiés).
  const [etablissementChoix, setEtablissementChoix] = useState<string>(
    contrat?.etablissementId ?? '',
  );
  const [nouvelNom, setNouvelNom] = useState('');
  const [nouvelEmail, setNouvelEmail] = useState('');
  const [mode, setMode] = useState<Mode>(
    contrat && estMode(contrat.mode) ? contrat.mode : 'CRECHE_PSU',
  );
  // Le contrat porte le lien `enfantId` (référence svc-foyer) : plus de
  // rapprochement fragile par prénom. `null` (contrat historique pas encore
  // back-fillé) retombe sur '' → l'utilisateur re-choisit dans le select.
  const [enfantId, setEnfantId] = useState<string>(
    contrat ? (contrat.enfantId ?? '') : (enfants[0]?.id ?? ''),
  );
  const [valideDu, setValideDu] = useState(contrat?.valideDu ?? '');
  const [valideAu, setValideAu] = useState(contrat?.valideAu ?? '');

  // CRECHE_PSU
  const [heuresAnnuelles, setHeuresAnnuelles] = useState(
    contrat?.heuresAnnuellesContractualisees !== undefined
      ? String(contrat.heuresAnnuellesContractualisees)
      : '1607',
  );
  const [nbMensualites, setNbMensualites] = useState(
    contrat?.nbMensualites !== undefined ? String(contrat.nbMensualites) : '12',
  );
  // Vrai dès que le parent a touché le champ des heures (ou qu'on édite un contrat
  // existant, dont la valeur fait foi) : la dérivation cesse alors de l'écraser.
  // Sans ce drapeau, corriger la valeur à la main serait impossible — chaque coche
  // de jour la remettrait à la valeur dérivée.
  const [heuresSaisiesAlaMain, setHeuresSaisiesAlaMain] = useState(edition);
  const [cochesJours, setCochesJours] = useState<
    Partial<Record<JourSemaine, boolean>>
  >(() => cochesDepuisSemaine(contrat?.semaineType));
  const [plagesJours, setPlagesJours] = useState<
    Partial<Record<JourSemaine, PlageHoraire>>
  >(() => {
    // Les jours cochés à l'ouverture (quatre, pour un nouveau contrat) reçoivent
    // la plage par défaut : sans cela l'écran montre des horaires que la saisie
    // ne porte pas.
    const initiales = plagesDepuisSemaine(contrat?.semaineType);
    const coches = cochesDepuisSemaine(contrat?.semaineType);
    for (const jour of JOURS_SEMAINE_OUVRES) {
      if (coches[jour] === true && initiales[jour] === undefined) {
        initiales[jour] = PLAGE_DEFAUT;
      }
    }
    return initiales;
  });

  // ---- Dérivation des heures annuelles depuis la semaine type ---------------
  //
  // Les heures annuelles ne sont pas une donnée indépendante : elles se déduisent
  // de la semaine type et de la période, toutes deux saisies juste ici. Le champ
  // proposait pourtant `1607` par défaut — la durée légale annuelle du *travail*
  // en France, qui n'a aucun sens comme volume de garde — sans que rien ne la
  // confronte au rythme choisi. On dérive donc la valeur, et on refuse celles que
  // la semaine type ne peut physiquement pas produire.
  const semaineTypeSaisie = useMemo(
    () => construireSemaineType(cochesJours, plagesJours),
    [cochesJours, plagesJours],
  );
  const periodeSaisie = useMemo(
    () => ({ valideDu, valideAu: valideAu.trim() === '' ? null : valideAu }),
    [valideDu, valideAu],
  );
  /** Plafond physique de la période, ou `null` (période ouverte / dates incomplètes). */
  const heuresMaximales = useMemo(
    () => heuresMaximalesSurPeriode(semaineTypeSaisie, periodeSaisie),
    [semaineTypeSaisie, periodeSaisie],
  );

  // Report automatique : cocher un jour ou changer les dates remplit le champ,
  // tant que le parent ne l'a pas lui-même modifié. Un plafond nul (aucun jour
  // gardé) n'est pas reporté : ce serait remplacer une valeur par une donnée
  // vide, alors que la saisie est simplement encore en cours.
  useEffect(() => {
    if (
      heuresSaisiesAlaMain ||
      heuresMaximales === null ||
      heuresMaximales === 0
    ) {
      return;
    }
    setHeuresAnnuelles(String(heuresMaximales));
  }, [heuresMaximales, heuresSaisiesAlaMain]);

  // ABCM
  const [semaineAbcm, setSemaineAbcm] = useState<SemaineAbcm>(() =>
    abcmDepuisSemaine(contrat?.semaineAbcm),
  );
  // Première inscription à l'association (lot 4a) : ABCM uniquement, pré-cochée
  // à l'édition si le contrat lu porte le champ à `true`.
  const [premiereInscription, setPremiereInscription] = useState(
    contrat?.premiereInscription === true,
  );

  const [chargement, setChargement] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);
  // Garde d'abandon : vrai dès la première saisie (onChange délégué au <form>),
  // pour ne confirmer l'annulation que s'il y a réellement quelque chose à perdre.
  const [saisieModifiee, setSaisieModifiee] = useState(false);
  const [confirmerAbandon, setConfirmerAbandon] = useState(false);

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }

  /** Id du message d'erreur d'un champ, pour le lier via `aria-describedby`. */
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  async function soumettre(ev: FormEvent) {
    ev.preventDefault();
    setChargement(true);
    setErreurGlobale(null);
    setErreursChamps([]);

    const enfantSelectionne = enfants.find((e) => e.id === enfantId);
    if (!enfantSelectionne) {
      setErreurGlobale('Veuillez sélectionner un enfant.');
      setChargement(false);
      return;
    }

    // Cohérence des dates côté client (retour immédiat ; le serveur revalide) :
    // une fin antérieure au début serait une période vide silencieuse.
    if (valideAu.trim() !== '' && valideAu < valideDu) {
      setErreursChamps([
        {
          champ: 'valideAu',
          message: 'La date de fin doit être après la date de début.',
        },
      ]);
      setErreurGlobale('Vérifiez les dates de validité du contrat.');
      setChargement(false);
      return;
    }

    // Lien établissement OBLIGATOIRE (P5, `etablissement_id` NOT NULL) : exactement
    // un — un établissement existant OU un nouvel établissement créé à la volée côté
    // service (même transaction que le contrat). Validé ici pour un retour immédiat.
    let lien: LienEtablissementSaisie;
    if (etablissementChoix === NOUVEL_ETABLISSEMENT) {
      const nom = nouvelNom.trim();
      if (nom === '') {
        setErreursChamps([
          {
            champ: 'nouvelEtablissementNom',
            message: 'Le nom du nouvel établissement est requis.',
          },
        ]);
        setErreurGlobale('Veuillez nommer le nouvel établissement.');
        setChargement(false);
        return;
      }
      lien = {
        nouvelEtablissement: {
          nom,
          ...(nouvelEmail.trim() !== ''
            ? { emailService: nouvelEmail.trim() }
            : {}),
        },
      };
    } else if (etablissementChoix !== '') {
      lien = { etablissementId: etablissementChoix };
    } else {
      setErreursChamps([
        {
          champ: 'etablissementId',
          message: 'Veuillez sélectionner ou créer un établissement.',
        },
      ]);
      setErreurGlobale('Un établissement est requis pour le contrat.');
      setChargement(false);
      return;
    }

    // Garde de cohérence, AVANT tout aller-retour réseau : le service refuse la
    // même chose (400), mais un refus immédiat évite au parent d'attendre pour
    // apprendre que sa saisie est impossible. Les deux bords lisent la MÊME
    // fonction (`@creche-planner/shared-semaine`) — c'est la duplication de cette
    // règle qui avait laissé passer le défaut.
    if (mode === 'CRECHE_PSU') {
      const heures = parseFloat(heuresAnnuelles);
      const messageHeures = messageCoherenceHeures(
        coherenceHeuresAnnuelles(semaineTypeSaisie, periodeSaisie, heures),
        heures,
      );
      if (messageHeures !== null) {
        setErreursChamps([
          {
            champ: 'heuresAnnuellesContractualisees',
            message: messageHeures,
          },
        ]);
        setErreurGlobale('Vérifiez les heures annuelles du contrat.');
        setChargement(false);
        return;
      }
    }

    const baseContrat = {
      foyerId,
      // Lien de référence (id svc-foyer) + prénom dénormalisé pour l'affichage
      // (rafraîchi côté services quand l'enfant est renommé).
      enfantId: enfantSelectionne.id,
      enfant: enfantSelectionne.prenom,
      valideDu,
      ...(valideAu.trim() !== '' ? { valideAu: valideAu } : { valideAu: null }),
      ...lien,
    };

    try {
      let contratLocal: ContratLocal | undefined;

      if (mode === 'CRECHE_PSU') {
        const semaineType = construireSemaineType(cochesJours, plagesJours);
        const saisie = {
          ...baseContrat,
          mode: 'CRECHE_PSU' as const,
          heuresAnnuellesContractualisees: parseFloat(heuresAnnuelles),
          nbMensualites: parseInt(nbMensualites, 10),
          semaineType,
        };
        const reponse = edition
          ? await api.modifierContrat(contrat.id, saisie)
          : await api.creerContrat(saisie);
        contratLocal = {
          ...reponse,
          heuresAnnuellesContractualisees:
            saisie.heuresAnnuellesContractualisees,
          nbMensualites: saisie.nbMensualites,
          semaineType: saisie.semaineType,
        };
      } else {
        const saisie = {
          ...baseContrat,
          mode,
          semaineAbcm: construireSemaineAbcmComplete(semaineAbcm),
          premiereInscription,
        };
        const reponse = edition
          ? await api.modifierContrat(contrat.id, saisie)
          : await api.creerContrat(saisie);
        contratLocal = {
          ...reponse,
          semaineAbcm: saisie.semaineAbcm,
        };
      }

      // Les deux branches ci-dessus affectent `contratLocal` : il est ici
      // toujours défini (la garde qui s'y trouvait était morte).
      onCree(contratLocal);
    } catch (err) {
      if (err instanceof ApiError) {
        const erreurs = extraireErreurs(err.corps);
        if (erreurs.length > 0) {
          setErreursChamps(erreurs);
        } else {
          setErreurGlobale(messageErreur(err));
        }
      } else {
        setErreurGlobale(messageErreur(err));
      }
    } finally {
      setChargement(false);
    }
  }

  return (
    <form
      onSubmit={(ev) => void soumettre(ev)}
      onChange={() => {
        // Délégué : toute saisie (input/select/checkbox) marque le brouillon.
        setSaisieModifiee(true);
      }}
    >
      <ChampErreur balise="p">{erreurGlobale}</ChampErreur>

      {/* Erreurs de champs non rattachées à un champ affiché (ex. semaineType).
          Les champs ci-dessous portent leur propre message lié (aria-describedby). */}
      {erreursChamps
        .filter((e) => !CHAMPS_LIES.has(e.champ))
        .map((e) => (
          <ChampErreur key={e.champ} balise="p">
            {e.message}
          </ChampErreur>
        ))}

      <label htmlFor="contrat-mode">Mode</label>
      <select
        id="contrat-mode"
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as Mode);
          setSemaineAbcm({});
        }}
        className="champ-large"
      >
        {MODES_SELECTIONNABLES.map((m) => (
          <option key={m} value={m}>
            {LIBELLES_MODE[m]}
          </option>
        ))}
      </select>
      <ChampErreur id={idErreur('mode')}>{erreurPour('mode')}</ChampErreur>

      <ChampFormulaire
        id="contrat-enfant"
        libelle={
          <>
            Enfant <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('enfant') ?? null}
        idErreur={idErreur('enfant')}
      >
        {(champ) => (
          <select
            {...champ}
            value={enfantId}
            onChange={(e) => {
              setEnfantId(e.target.value);
            }}
            required
            className="champ-large"
          >
            <option value="">— Sélectionner un enfant —</option>
            {enfants.map((e) => (
              <option key={e.id} value={e.id}>
                {e.prenom}
              </option>
            ))}
          </select>
        )}
      </ChampFormulaire>

      <ChampFormulaire
        id="contrat-valideDu"
        libelle={
          <>
            Valide du <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('valideDu') ?? null}
        idErreur={idErreur('valideDu')}
      >
        {(champ) => (
          <input
            {...champ}
            type="date"
            required
            value={valideDu}
            onChange={(e) => {
              setValideDu(e.target.value);
            }}
            className="champ-large"
          />
        )}
      </ChampFormulaire>

      <ChampFormulaire
        id="contrat-valideAu"
        libelle="Valide au (laisser vide si ouvert)"
        erreur={erreurPour('valideAu') ?? null}
        idErreur={idErreur('valideAu')}
      >
        {(champ) => (
          <input
            {...champ}
            type="date"
            value={valideAu}
            onChange={(e) => {
              setValideAu(e.target.value);
            }}
            className="champ-large"
          />
        )}
      </ChampFormulaire>

      <ChampFormulaire
        id="contrat-etablissement"
        libelle={
          <>
            Établissement <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('etablissementId') ?? null}
        idErreur={idErreur('etablissementId')}
      >
        {(champ) => (
          <select
            {...champ}
            value={etablissementChoix}
            onChange={(e) => {
              setEtablissementChoix(e.target.value);
            }}
            className="champ-large"
          >
            <option value="">— Sélectionner un établissement —</option>
            {/* Archivage réel (Lot 3) : on ne propose que les établissements ACTIFS pour
                un nouveau rattachement. À l'édition d'un contrat déjà rattaché à un
                archivé, on garde CETTE option (suffixe « (archivé) ») pour qu'elle reste
                sélectionnée/affichée ; les autres archivés n'apparaissent pas. */}
            {etablissements
              .filter((e) => e.actif || e.id === contrat?.etablissementId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom}
                  {e.actif ? '' : ' (archivé)'}
                </option>
              ))}
            <option value={NOUVEL_ETABLISSEMENT}>
              ➕ Créer une nouvelle crèche / école
            </option>
          </select>
        )}
      </ChampFormulaire>

      {etablissementChoix === NOUVEL_ETABLISSEMENT && (
        <fieldset className="bloc-champs" style={{ margin: '0.5rem 0 0' }}>
          <legend>Nouvel établissement</legend>
          <ChampFormulaire
            id="contrat-nouvel-etab-nom"
            libelle={
              <>
                Nom du nouvel établissement <span aria-hidden="true">*</span>
              </>
            }
            requis
            erreur={erreurPour('nouvelEtablissementNom') ?? null}
            idErreur={idErreur('nouvelEtablissementNom')}
          >
            {(champ) => (
              <input
                {...champ}
                type="text"
                required
                value={nouvelNom}
                onChange={(e) => {
                  setNouvelNom(e.target.value);
                }}
                className="champ-large"
              />
            )}
          </ChampFormulaire>
          <label htmlFor="contrat-nouvel-etab-email">
            Adresse e-mail du service
          </label>
          <input
            id="contrat-nouvel-etab-email"
            type="email"
            value={nouvelEmail}
            onChange={(e) => {
              setNouvelEmail(e.target.value);
            }}
            className="champ-large"
          />
        </fieldset>
      )}

      {mode === 'CRECHE_PSU' && (
        <>
          <ChampFormulaire
            id="heuresAnnuelles"
            libelle={
              <>
                {'Heures annuelles contractualisées '}
                <span aria-hidden="true">*</span>
              </>
            }
            requis
            erreur={erreurPour('heuresAnnuellesContractualisees') ?? null}
            idErreur={idErreur('heuresAnnuellesContractualisees')}
          >
            {(champ) => (
              <input
                {...champ}
                type="number"
                min="1"
                step="0.5"
                required
                value={heuresAnnuelles}
                onChange={(e) => {
                  // Reprendre la main gèle la dérivation : le contrat papier fait
                  // foi, l'application ne doit pas réécrire ce que le parent tape.
                  setHeuresSaisiesAlaMain(true);
                  setHeuresAnnuelles(e.target.value);
                }}
                className="champ-large"
              />
            )}
          </ChampFormulaire>
          {heuresMaximales !== null && heuresMaximales > 0 && (
            <p className="muted" style={{ margin: '0.15rem 0 0' }}>
              {`Calculé depuis votre semaine type et la période : au plus ${heuresMaximales} h, `}
              {
                'sans aucune fermeture. Ajustez à la baisse selon les semaines de '
              }
              {'fermeture de l’établissement.'}
            </p>
          )}

          <ChampFormulaire
            id="nbMensualites"
            libelle={
              <>
                Nombre de mensualités <span aria-hidden="true">*</span>
              </>
            }
            requis
            erreur={erreurPour('nbMensualites') ?? null}
            idErreur={idErreur('nbMensualites')}
          >
            {(champ) => (
              <input
                {...champ}
                type="number"
                min="1"
                max="12"
                step="1"
                required
                value={nbMensualites}
                onChange={(e) => {
                  setNbMensualites(e.target.value);
                }}
                className="champ-large"
              />
            )}
          </ChampFormulaire>

          <fieldset className="bloc-champs" style={{ margin: '0.75rem 0 0' }}>
            <legend>Semaine type (jours et horaires)</legend>
            {JOURS_SEMAINE_OUVRES.map((jour) => {
              const plage = plagesJours[jour] ?? PLAGE_DEFAUT;
              return (
                <PlageEditor
                  key={jour}
                  jour={jour}
                  coche={cochesJours[jour] === true}
                  plage={plage}
                  onCoche={(val) => {
                    setCochesJours((prev) => {
                      const { [jour]: _retire, ...sansJour } = prev;
                      return val ? { ...prev, [jour]: true } : sansJour;
                    });
                    // Cocher un jour lui DONNE sa plage par défaut. Sans cela,
                    // `construireSemaineType` rendait `[]` pour un jour coché
                    // dont les horaires n'avaient pas été touchés : les 8 h 00 →
                    // 17 h 30 affichés n'étaient qu'un décor, et le contrat
                    // partait avec une journée vide — donc des heures annuelles
                    // qui ne correspondaient à rien.
                    if (val) {
                      setPlagesJours((prev) =>
                        prev[jour] ? prev : { ...prev, [jour]: PLAGE_DEFAUT },
                      );
                    }
                  }}
                  onPlage={(p) => {
                    setPlagesJours((prev) => ({ ...prev, [jour]: p }));
                  }}
                />
              );
            })}
          </fieldset>
        </>
      )}

      {mode !== 'CRECHE_PSU' && (
        <>
          <fieldset className="bloc-champs" style={{ margin: '0.75rem 0 0' }}>
            <legend>Inscriptions hebdomadaires</legend>
            {mode === 'ALSH' ? (
              <>
                <p className="muted" style={{ margin: '0 0 0.5rem' }}>
                  Cochez les jours d’accueil de loisirs (
                  <Abbr sigle="ALSH" />) réguliers, chaque semaine. Les jours de
                  vacances se réservent par date, depuis le planning.
                </p>
                <AlshHebdoEditor
                  semaineAbcm={semaineAbcm}
                  onChange={setSemaineAbcm}
                />
              </>
            ) : (
              <AbcmEditor
                mode={mode}
                semaineAbcm={semaineAbcm}
                onChange={setSemaineAbcm}
              />
            )}
          </fieldset>

          {/* Première inscription à l'association (lot 4a) : ABCM uniquement —
              jamais affichée pour un contrat crèche (CRECHE_PSU). */}
          <label
            className="mt-3"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <input
              type="checkbox"
              checked={premiereInscription}
              onChange={(e) => {
                setPremiereInscription(e.target.checked);
              }}
            />
            Première inscription de l’enfant à l’association
          </label>
          <p className="muted" style={{ margin: '0.15rem 0 0' }}>
            Ajoute les frais de première inscription (150 €) au mois de
            septembre de la première année.
          </p>
        </>
      )}

      <div className="mt-4" style={{ display: 'flex', gap: '0.5rem' }}>
        <Bouton type="submit" disabled={chargement}>
          {chargement
            ? edition
              ? 'Enregistrement…'
              : 'Création…'
            : edition
              ? 'Enregistrer les modifications'
              : 'Créer le contrat'}
        </Bouton>
        {onAnnuler && (
          <Bouton
            variante="secondaire"
            onClick={() => {
              // Rien saisi → fermeture directe ; sinon confirmation (la saisie
              // n'est pas enregistrée et serait perdue sans retour possible).
              if (saisieModifiee) {
                setConfirmerAbandon(true);
              } else {
                onAnnuler();
              }
            }}
          >
            Annuler
          </Bouton>
        )}
      </div>
      <ModaleConfirmation
        ouvert={confirmerAbandon}
        titre="Abandonner la saisie"
        message="Vos modifications ne sont pas enregistrées et seront perdues."
        libelleConfirmer="Abandonner"
        onConfirmer={() => {
          setConfirmerAbandon(false);
          onAnnuler?.();
        }}
        onAnnuler={() => {
          setConfirmerAbandon(false);
        }}
      />
    </form>
  );
}
