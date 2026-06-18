import { type FormEvent, useId, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  EnfantVue,
  ContratLocal,
  Mode,
  JourSemaine,
  PlageHoraire,
  SemaineTypeCreche,
  SemaineAbcm,
  InscriptionsJour,
} from '../types/bff';
import { JOURS_SEMAINE, LIBELLES_JOURS } from '../utils/dates';
import {
  extraireErreurs,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { LIBELLES_MODE, estMode } from '../utils/libelles';
import { Abbr } from '../ui/Abbr';

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
]);

const JOURS_SEMAINE_OUVRES: JourSemaine[] = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
];

// ---- UT-10 : binding de la colonne « Inscrit ALSH » --------------------------
//
// ÉCART AMONT DOCUMENTÉ (spec 11 UT-10 / CA3) : le DTO `InscriptionsJour`
// (`types/bff.ts`, miroir de `libs/planification/domain` → `InscriptionsJour`)
// ne décrit QUE `cantine | periMatin | periSoir`. Il n'existe AUCUN champ ALSH
// hebdomadaire dans le contrat de données : côté domaine, l'ALSH (mercredis /
// vacances) se saisit **par dates explicites** (`JourAlsh[]`, cf.
// `EcrirePlanning.joursAlsh`), pas via une case de semaine type.
//
// Le bug d'origine faisait écrire la colonne « Inscrit ALSH » dans `insc.cantine`
// (collision silencieuse avec la cantine). Correction front, SANS toucher au
// contrat d'API (hors périmètre) : on écrit dans une clé locale dédiée `alsh`,
// distincte de `cantine`. Cette clé n'est pas (encore) modélisée par le DTO ; le
// passthrough `additionalProperties: true` de la gateway la tolère, et
// svc-planification l'ignore tant que l'ALSH hebdomadaire n'est pas spécifié en
// amont. L'essentiel pour ce lot : la saisie ALSH ne corrompt plus `cantine`.
interface InscriptionsJourEtendue extends InscriptionsJour {
  /** Présence ALSH hebdomadaire — champ FRONT (non modélisé par le DTO, cf. note ci-dessus). */
  alsh?: boolean;
}

type ChampInscription = keyof InscriptionsJourEtendue;

// ---- Éditeur de plage horaire (CRECHE_PSU) -----------------------------------

interface PlageEditorProps {
  jour: JourSemaine;
  coche: boolean;
  plage: PlageHoraire;
  onCoche: (coche: boolean) => void;
  onPlage: (plage: PlageHoraire) => void;
}

function PlageEditor({
  jour,
  coche,
  plage,
  onCoche,
  onPlage,
}: PlageEditorProps) {
  function toTime(h: number, m: number): string {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function fromTime(val: string): { heures: number; minutes: number } {
    const parts = val.split(':');
    return {
      heures: parseInt(parts[0] ?? '0', 10),
      minutes: parseInt(parts[1] ?? '0', 10),
    };
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: '0.4rem',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          margin: 0,
          minWidth: 90,
        }}
      >
        <input
          type="checkbox"
          checked={coche}
          onChange={(e) => {
            onCoche(e.target.checked);
          }}
        />
        {LIBELLES_JOURS[jour]}
      </label>
      {coche && (
        <>
          <label style={{ margin: 0, fontSize: '0.85rem', color: 'inherit' }}>
            Début
            <input
              type="time"
              value={toTime(plage.debutHeures, plage.debutMinutes)}
              onChange={(e) => {
                const { heures, minutes } = fromTime(e.target.value);
                onPlage({
                  ...plage,
                  debutHeures: heures,
                  debutMinutes: minutes,
                });
              }}
              style={{ marginLeft: '0.3rem' }}
            />
          </label>
          <label style={{ margin: 0, fontSize: '0.85rem', color: 'inherit' }}>
            Fin
            <input
              type="time"
              value={toTime(plage.finHeures, plage.finMinutes)}
              onChange={(e) => {
                const { heures, minutes } = fromTime(e.target.value);
                onPlage({ ...plage, finHeures: heures, finMinutes: minutes });
              }}
              style={{ marginLeft: '0.3rem' }}
            />
          </label>
        </>
      )}
    </div>
  );
}

// ---- Éditeur semaine ABCM (CANTINE/PERISCOLAIRE/ALSH) -----------------------

interface AbcmEditorProps {
  mode: 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';
  semaineAbcm: SemaineAbcm;
  onChange: (s: SemaineAbcm) => void;
}

function AbcmEditor({ mode, semaineAbcm, onChange }: AbcmEditorProps) {
  const montrerCantine = mode === 'CANTINE' || mode === 'PERISCOLAIRE';
  const montrerPeriMatin = mode === 'PERISCOLAIRE';
  const montrerPeriSoir = mode === 'PERISCOLAIRE';

  function inscriptionJour(jour: JourSemaine): InscriptionsJourEtendue {
    return semaineAbcm[jour] ?? {};
  }

  function mettreAJour(
    jour: JourSemaine,
    champ: ChampInscription,
    val: boolean,
  ) {
    const actuel = inscriptionJour(jour);
    const suivant: InscriptionsJourEtendue = { ...actuel };
    if (val) {
      suivant[champ] = true;
    } else {
      delete suivant[champ];
    }
    const nouveauJour = Object.keys(suivant).length === 0 ? undefined : suivant;
    const nouvelleAbcm: SemaineAbcm = { ...semaineAbcm };
    if (nouveauJour === undefined) {
      delete nouvelleAbcm[jour];
    } else {
      nouvelleAbcm[jour] = nouveauJour;
    }
    onChange(nouvelleAbcm);
  }

  return (
    <table
      style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}
    >
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: 'left', paddingRight: '1rem' }}>
            Jour
          </th>
          {montrerCantine && <th scope="col">Cantine</th>}
          {montrerPeriMatin && <th scope="col">Péri matin</th>}
          {montrerPeriSoir && <th scope="col">Péri soir</th>}
          {mode === 'ALSH' && (
            <th scope="col">
              Inscrit <Abbr sigle="ALSH" />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {JOURS_SEMAINE_OUVRES.map((jour) => {
          const insc = inscriptionJour(jour);
          return (
            <tr key={jour}>
              <th
                scope="row"
                style={{ textAlign: 'left', paddingRight: '1rem' }}
              >
                {LIBELLES_JOURS[jour]}
              </th>
              {montrerCantine && (
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={insc.cantine === true}
                    onChange={(e) => {
                      mettreAJour(jour, 'cantine', e.target.checked);
                    }}
                    aria-label={`Cantine ${LIBELLES_JOURS[jour]}`}
                  />
                </td>
              )}
              {montrerPeriMatin && (
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={insc.periMatin === true}
                    onChange={(e) => {
                      mettreAJour(jour, 'periMatin', e.target.checked);
                    }}
                    aria-label={`Périscolaire matin ${LIBELLES_JOURS[jour]}`}
                  />
                </td>
              )}
              {montrerPeriSoir && (
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={insc.periSoir === true}
                    onChange={(e) => {
                      mettreAJour(jour, 'periSoir', e.target.checked);
                    }}
                    aria-label={`Périscolaire soir ${LIBELLES_JOURS[jour]}`}
                  />
                </td>
              )}
              {mode === 'ALSH' && (
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={insc.alsh === true}
                    onChange={(e) => {
                      mettreAJour(jour, 'alsh', e.target.checked);
                    }}
                    aria-label={`ALSH ${LIBELLES_JOURS[jour]}`}
                  />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- ContratForm -------------------------------------------------------------

export interface ContratFormProps {
  foyerId: string;
  enfants: EnfantVue[];
  /** Contrat à éditer ; absent ⇒ mode création. */
  contrat?: ContratLocal;
  /** Callback de succès (création OU modification). */
  onCree: (c: ContratLocal) => void;
  onAnnuler?: () => void;
}

/** Coches initiales de la semaine type : jours portant au moins une plage. */
function cochesDepuisSemaine(
  semaine: ContratLocal['semaineType'],
): Partial<Record<JourSemaine, boolean>> {
  if (!semaine) {
    return { LUNDI: true, MARDI: true, JEUDI: true, VENDREDI: true };
  }
  const coches: Partial<Record<JourSemaine, boolean>> = {};
  for (const jour of JOURS_SEMAINE_OUVRES) {
    if ((semaine[jour]?.length ?? 0) > 0) {
      coches[jour] = true;
    }
  }
  return coches;
}

/** Plages initiales de la semaine type (1ʳᵉ plage de chaque jour gardé). */
function plagesDepuisSemaine(
  semaine: ContratLocal['semaineType'],
): Partial<Record<JourSemaine, PlageHoraire>> {
  const p: Partial<Record<JourSemaine, PlageHoraire>> = {};
  for (const jour of JOURS_SEMAINE_OUVRES) {
    const premiere = semaine?.[jour]?.[0];
    p[jour] = premiere ?? {
      debutHeures: 8,
      debutMinutes: 0,
      finHeures: 17,
      finMinutes: 30,
    };
  }
  return p;
}

/** Inscriptions ABCM initiales (jours ouvrés seulement, pour l'éditeur). */
function abcmDepuisSemaine(semaine: ContratLocal['semaineAbcm']): SemaineAbcm {
  if (!semaine) {
    return {};
  }
  const s: SemaineAbcm = {};
  for (const jour of JOURS_SEMAINE_OUVRES) {
    const insc = semaine[jour];
    if (insc && Object.keys(insc).length > 0) {
      s[jour] = insc;
    }
  }
  return s;
}

export function ContratForm({
  foyerId,
  enfants,
  contrat,
  onCree,
  onAnnuler,
}: ContratFormProps) {
  const edition = contrat !== undefined;
  const idBase = useId();
  const [mode, setMode] = useState<Mode>(
    contrat && estMode(contrat.mode) ? contrat.mode : 'CRECHE_PSU',
  );
  const [enfantId, setEnfantId] = useState<string>(
    contrat
      ? (enfants.find((e) => e.prenom === contrat.enfant)?.id ?? '')
      : (enfants[0]?.id ?? ''),
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

  const [chargement, setChargement] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }

  /** Id du message d'erreur d'un champ, pour le lier via `aria-describedby`. */
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  // svc-planification exige les 7 jours présents : tableau de plages pour un jour
  // gardé, tableau vide sinon (sinon 400 « expected array, received undefined »).
  function construireSemaineType(): SemaineTypeCreche {
    const s: SemaineTypeCreche = {};
    for (const jour of JOURS_SEMAINE) {
      const plage = plagesJours[jour];
      s[jour] = cochesJours[jour] && plage ? [plage] : [];
    }
    return s;
  }

  // Idem ABCM : les 7 jours présents, objet vide pour un jour sans inscription.
  function construireSemaineAbcmComplete(): SemaineAbcm {
    const s: SemaineAbcm = {};
    for (const jour of JOURS_SEMAINE) {
      s[jour] = semaineAbcm[jour] ?? {};
    }
    return s;
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

    const baseContrat = {
      foyerId,
      enfant: enfantSelectionne.prenom,
      valideDu,
      ...(valideAu.trim() !== '' ? { valideAu: valideAu } : { valideAu: null }),
    };

    try {
      let contratLocal: ContratLocal | undefined;

      if (mode === 'CRECHE_PSU') {
        const semaineType = construireSemaineType();
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
          semaineAbcm: construireSemaineAbcmComplete(),
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
    <form onSubmit={(ev) => void soumettre(ev)}>
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
        <fieldset style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Inscriptions hebdomadaires
          </legend>
          <AbcmEditor
            mode={mode}
            semaineAbcm={semaineAbcm}
            onChange={setSemaineAbcm}
          />
        </fieldset>
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
          <button type="button" className="btn secondaire" onClick={onAnnuler}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}
