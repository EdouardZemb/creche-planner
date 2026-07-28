import { type FormEvent, useId, useState } from 'react';
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
  const [cochesJours, setCochesJours] = useState<
    Partial<Record<JourSemaine, boolean>>
  >(() => cochesDepuisSemaine(contrat?.semaineType));
  const [plagesJours, setPlagesJours] = useState<
    Partial<Record<JourSemaine, PlageHoraire>>
  >(() => plagesDepuisSemaine(contrat?.semaineType));

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
        const reponse =
          edition && contrat
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
        const reponse =
          edition && contrat
            ? await api.modifierContrat(contrat.id, saisie)
            : await api.creerContrat(saisie);
        contratLocal = {
          ...reponse,
          semaineAbcm: saisie.semaineAbcm,
        };
      }

      if (contratLocal !== undefined) {
        onCree(contratLocal);
      }
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
      {erreurGlobale && (
        <p className="debit" role="alert">
          {erreurGlobale}
        </p>
      )}

      {/* Erreurs de champs non rattachées à un champ affiché (ex. semaineType).
          Les champs ci-dessous portent leur propre message lié (aria-describedby). */}
      {erreursChamps
        .filter((e) => !CHAMPS_LIES.has(e.champ))
        .map((e) => (
          <p key={e.champ} className="debit" role="alert">
            {e.message}
          </p>
        ))}

      <label htmlFor="contrat-mode">Mode</label>
      <select
        id="contrat-mode"
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as Mode);
          setSemaineAbcm({});
        }}
        style={{ width: '100%' }}
      >
        {MODES_SELECTIONNABLES.map((m) => (
          <option key={m} value={m}>
            {LIBELLES_MODE[m]}
          </option>
        ))}
      </select>
      {erreurPour('mode') && (
        <span id={idErreur('mode')} className="debit" role="alert">
          {erreurPour('mode')}
        </span>
      )}

      <label htmlFor="contrat-enfant">
        Enfant <span aria-hidden="true">*</span>
      </label>
      <select
        id="contrat-enfant"
        value={enfantId}
        onChange={(e) => {
          setEnfantId(e.target.value);
        }}
        required
        aria-required="true"
        aria-invalid={erreurPour('enfant') ? true : undefined}
        {...(erreurPour('enfant')
          ? { 'aria-describedby': idErreur('enfant') }
          : {})}
        style={{ width: '100%' }}
      >
        <option value="">— Sélectionner un enfant —</option>
        {enfants.map((e) => (
          <option key={e.id} value={e.id}>
            {e.prenom}
          </option>
        ))}
      </select>
      {erreurPour('enfant') && (
        <span id={idErreur('enfant')} className="debit" role="alert">
          {erreurPour('enfant')}
        </span>
      )}

      <label htmlFor="contrat-valideDu">
        Valide du <span aria-hidden="true">*</span>
      </label>
      <input
        id="contrat-valideDu"
        type="date"
        required
        aria-required="true"
        aria-invalid={erreurPour('valideDu') ? true : undefined}
        {...(erreurPour('valideDu')
          ? { 'aria-describedby': idErreur('valideDu') }
          : {})}
        value={valideDu}
        onChange={(e) => {
          setValideDu(e.target.value);
        }}
        style={{ width: '100%' }}
      />
      {erreurPour('valideDu') && (
        <span id={idErreur('valideDu')} className="debit" role="alert">
          {erreurPour('valideDu')}
        </span>
      )}

      <label htmlFor="contrat-valideAu">
        Valide au (laisser vide si ouvert)
      </label>
      <input
        id="contrat-valideAu"
        type="date"
        aria-invalid={erreurPour('valideAu') ? true : undefined}
        {...(erreurPour('valideAu')
          ? { 'aria-describedby': idErreur('valideAu') }
          : {})}
        value={valideAu}
        onChange={(e) => {
          setValideAu(e.target.value);
        }}
        style={{ width: '100%' }}
      />
      {erreurPour('valideAu') && (
        <span id={idErreur('valideAu')} className="debit" role="alert">
          {erreurPour('valideAu')}
        </span>
      )}

      <label htmlFor="contrat-etablissement">
        Établissement <span aria-hidden="true">*</span>
      </label>
      <select
        id="contrat-etablissement"
        value={etablissementChoix}
        aria-required="true"
        aria-invalid={erreurPour('etablissementId') ? true : undefined}
        {...(erreurPour('etablissementId')
          ? { 'aria-describedby': idErreur('etablissementId') }
          : {})}
        onChange={(e) => {
          setEtablissementChoix(e.target.value);
        }}
        style={{ width: '100%' }}
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
      {erreurPour('etablissementId') && (
        <span id={idErreur('etablissementId')} className="debit" role="alert">
          {erreurPour('etablissementId')}
        </span>
      )}

      {etablissementChoix === NOUVEL_ETABLISSEMENT && (
        <fieldset style={{ border: 'none', padding: 0, margin: '0.5rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Nouvel établissement
          </legend>
          <label htmlFor="contrat-nouvel-etab-nom">
            Nom du nouvel établissement <span aria-hidden="true">*</span>
          </label>
          <input
            id="contrat-nouvel-etab-nom"
            type="text"
            required
            aria-required="true"
            aria-invalid={
              erreurPour('nouvelEtablissementNom') ? true : undefined
            }
            {...(erreurPour('nouvelEtablissementNom')
              ? { 'aria-describedby': idErreur('nouvelEtablissementNom') }
              : {})}
            value={nouvelNom}
            onChange={(e) => {
              setNouvelNom(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('nouvelEtablissementNom') && (
            <span
              id={idErreur('nouvelEtablissementNom')}
              className="debit"
              role="alert"
            >
              {erreurPour('nouvelEtablissementNom')}
            </span>
          )}
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
            style={{ width: '100%' }}
          />
        </fieldset>
      )}

      {mode === 'CRECHE_PSU' && (
        <>
          <label htmlFor="heuresAnnuelles">
            Heures annuelles contractualisées <span aria-hidden="true">*</span>
          </label>
          <input
            id="heuresAnnuelles"
            type="number"
            min="1"
            step="0.5"
            required
            aria-required="true"
            aria-invalid={
              erreurPour('heuresAnnuellesContractualisees') ? true : undefined
            }
            {...(erreurPour('heuresAnnuellesContractualisees')
              ? {
                  'aria-describedby': idErreur(
                    'heuresAnnuellesContractualisees',
                  ),
                }
              : {})}
            value={heuresAnnuelles}
            onChange={(e) => {
              setHeuresAnnuelles(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('heuresAnnuellesContractualisees') && (
            <span
              id={idErreur('heuresAnnuellesContractualisees')}
              className="debit"
              role="alert"
            >
              {erreurPour('heuresAnnuellesContractualisees')}
            </span>
          )}

          <label htmlFor="nbMensualites">
            Nombre de mensualités <span aria-hidden="true">*</span>
          </label>
          <input
            id="nbMensualites"
            type="number"
            min="1"
            max="12"
            step="1"
            required
            aria-required="true"
            aria-invalid={erreurPour('nbMensualites') ? true : undefined}
            {...(erreurPour('nbMensualites')
              ? { 'aria-describedby': idErreur('nbMensualites') }
              : {})}
            value={nbMensualites}
            onChange={(e) => {
              setNbMensualites(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('nbMensualites') && (
            <span id={idErreur('nbMensualites')} className="debit" role="alert">
              {erreurPour('nbMensualites')}
            </span>
          )}

          <fieldset
            style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}
          >
            <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              Semaine type (jours et horaires)
            </legend>
            {JOURS_SEMAINE_OUVRES.map((jour) => {
              const plage = plagesJours[jour] ?? {
                debutHeures: 8,
                debutMinutes: 0,
                finHeures: 17,
                finMinutes: 30,
              };
              return (
                <PlageEditor
                  key={jour}
                  jour={jour}
                  coche={cochesJours[jour] === true}
                  plage={plage}
                  onCoche={(val) => {
                    setCochesJours((prev) => {
                      const n = { ...prev };
                      if (val) {
                        n[jour] = true;
                      } else {
                        delete n[jour];
                      }
                      return n;
                    });
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
          <fieldset
            style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}
          >
            <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              Inscriptions hebdomadaires
            </legend>
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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              marginTop: '0.75rem',
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

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button type="submit" className="btn" disabled={chargement}>
          {chargement
            ? edition
              ? 'Enregistrement…'
              : 'Création…'
            : edition
              ? 'Enregistrer les modifications'
              : 'Créer le contrat'}
        </button>
        {onAnnuler && (
          <button
            type="button"
            className="btn secondaire"
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
          </button>
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
