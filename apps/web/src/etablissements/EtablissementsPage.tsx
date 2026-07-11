import { type FormEvent, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type {
  CreerEtablissement,
  EtablissementFoyerVue,
  Mode,
  PreavisRegle,
} from '../types/bff';
import {
  extraireErreurs,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { LIBELLES_MODE } from '../utils/libelles';
import { useTitrePage } from '../hooks/useTitrePage';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { useEtablissements } from './useEtablissements';

/** Jours de la semaine pour la règle « jour + heure ». */
const JOURS = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

type Jour = (typeof JOURS)[number];

/** Modes de garde proposables par un établissement (champ informatif `types`). */
const MODES: Mode[] = ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'];

/** Forme du préavis pilotée par les radios (« Aucune » → préavis null). */
type FormePreavis = 'AUCUN' | 'JOURS_OUVRES' | 'JOUR_HEURE';

/** Rend une règle de préavis en phrase lisible (récap de la carte). */
function decrirePreavis(regle: PreavisRegle | null): string {
  if (regle === null) return 'aucune règle de préavis';
  if (regle.type === 'JOURS_OUVRES') {
    return `${regle.valeur} jour${regle.valeur > 1 ? 's' : ''} ouvré${
      regle.valeur > 1 ? 's' : ''
    }`;
  }
  const jour = regle.jour.charAt(0) + regle.jour.slice(1).toLowerCase();
  return `${jour} avant ${regle.heure}`;
}

/** Libellé accentué d'un mode (repli sur la valeur brute si inconnue). */
function libelleType(t: string): string {
  return t in LIBELLES_MODE ? LIBELLES_MODE[t as Mode] : t;
}

// ---- Formulaire création / édition -----------------------------------------

interface EtablissementFormProps {
  foyerId: string;
  /** Établissement à éditer ; absent ⇒ mode création. */
  etablissement?: EtablissementFoyerVue;
  onEnregistre: (e: EtablissementFoyerVue) => void;
  onAnnuler: () => void;
}

/**
 * Formulaire d'un établissement (création ou édition) : nom (requis), e-mail de
 * service, règle de préavis (aucune / jours ouvrés / jour + heure), types proposés
 * (multi) et coordonnées. Les erreurs par champ remontées par le BFF sont liées en
 * `aria-describedby`.
 */
function EtablissementForm({
  foyerId,
  etablissement,
  onEnregistre,
  onAnnuler,
}: EtablissementFormProps) {
  const edition = etablissement !== undefined;
  const idBase = useId();

  // Règle de préavis existante, narrow une fois pour dériver les valeurs initiales.
  const preavis = etablissement?.preavisRegle ?? null;

  const [nom, setNom] = useState(etablissement?.nom ?? '');
  const [emailService, setEmailService] = useState(
    etablissement?.emailService ?? '',
  );
  const [formePreavis, setFormePreavis] = useState<FormePreavis>(
    preavis?.type ?? 'AUCUN',
  );
  const [valeurJours, setValeurJours] = useState(
    preavis?.type === 'JOURS_OUVRES' ? String(preavis.valeur) : '2',
  );
  const [jour, setJour] = useState<Jour>(
    preavis?.type === 'JOUR_HEURE'
      ? (JOURS.find((j) => j === preavis.jour) ?? 'JEUDI')
      : 'JEUDI',
  );
  const [heure, setHeure] = useState(
    preavis?.type === 'JOUR_HEURE' ? preavis.heure : '12:00',
  );
  const [types, setTypes] = useState<Mode[]>(
    (etablissement?.types ?? []).filter((t): t is Mode => t in LIBELLES_MODE),
  );
  const [adresse, setAdresse] = useState(etablissement?.adresse ?? '');
  const [telephone, setTelephone] = useState(etablissement?.telephone ?? '');
  const [contact, setContact] = useState(etablissement?.contact ?? '');

  const [chargement, setChargement] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  function basculerType(mode: Mode, coche: boolean) {
    setTypes((prev) =>
      coche ? [...prev, mode] : prev.filter((m) => m !== mode),
    );
  }

  /** `''` → `null` (champ vidé), sinon la valeur ébarbée. */
  function ouNull(valeur: string): string | null {
    const v = valeur.trim();
    return v === '' ? null : v;
  }

  function construirePreavis(): PreavisRegle | null {
    if (formePreavis === 'JOURS_OUVRES') {
      return { type: 'JOURS_OUVRES', valeur: Number(valeurJours) };
    }
    if (formePreavis === 'JOUR_HEURE') {
      return { type: 'JOUR_HEURE', jour, heure };
    }
    return null;
  }

  async function soumettre(ev: FormEvent) {
    ev.preventDefault();
    setChargement(true);
    setErreurGlobale(null);
    setErreursChamps([]);

    const corps: CreerEtablissement = {
      nom: nom.trim(),
      emailService: ouNull(emailService),
      preavisRegle: construirePreavis(),
      types,
      adresse: ouNull(adresse),
      telephone: ouNull(telephone),
      contact: ouNull(contact),
    };

    try {
      const reponse =
        edition && etablissement
          ? await api.modifierEtablissement(foyerId, etablissement.id, corps)
          : await api.creerEtablissement(foyerId, corps);
      onEnregistre(reponse);
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
      {erreursChamps
        .filter((e) => e.champ !== 'nom' && e.champ !== 'emailService')
        .map((e) => (
          <p key={e.champ} className="debit" role="alert">
            {e.message}
          </p>
        ))}

      <label htmlFor={`${idBase}-nom`}>
        Nom de l’établissement <span aria-hidden="true">*</span>
      </label>
      <input
        id={`${idBase}-nom`}
        type="text"
        required
        aria-required="true"
        aria-invalid={erreurPour('nom') ? true : undefined}
        {...(erreurPour('nom') ? { 'aria-describedby': idErreur('nom') } : {})}
        value={nom}
        onChange={(e) => {
          setNom(e.target.value);
        }}
        style={{ width: '100%' }}
      />
      {erreurPour('nom') && (
        <span id={idErreur('nom')} className="debit" role="alert">
          {erreurPour('nom')}
        </span>
      )}

      <label htmlFor={`${idBase}-email`}>Adresse e-mail du service</label>
      <input
        id={`${idBase}-email`}
        type="email"
        aria-invalid={erreurPour('emailService') ? true : undefined}
        {...(erreurPour('emailService')
          ? { 'aria-describedby': idErreur('emailService') }
          : {})}
        value={emailService}
        onChange={(e) => {
          setEmailService(e.target.value);
        }}
        style={{ width: '100%' }}
      />
      {erreurPour('emailService') && (
        <span id={idErreur('emailService')} className="debit" role="alert">
          {erreurPour('emailService')}
        </span>
      )}

      <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
          Règle de préavis
        </legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="radio"
            name={`${idBase}-preavis`}
            checked={formePreavis === 'AUCUN'}
            onChange={() => {
              setFormePreavis('AUCUN');
            }}
          />
          Aucune règle
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="radio"
            name={`${idBase}-preavis`}
            checked={formePreavis === 'JOURS_OUVRES'}
            onChange={() => {
              setFormePreavis('JOURS_OUVRES');
            }}
          />
          En jours ouvrés
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="radio"
            name={`${idBase}-preavis`}
            checked={formePreavis === 'JOUR_HEURE'}
            onChange={() => {
              setFormePreavis('JOUR_HEURE');
            }}
          />
          Un jour + une heure butoir
        </label>

        {formePreavis === 'JOURS_OUVRES' && (
          <div style={{ marginTop: '0.5rem' }}>
            <label htmlFor={`${idBase}-valeur`}>Nombre de jours ouvrés</label>
            <input
              id={`${idBase}-valeur`}
              type="number"
              min={0}
              max={30}
              step={1}
              required
              value={valeurJours}
              onChange={(e) => {
                setValeurJours(e.target.value);
              }}
              style={{ width: '100%' }}
            />
          </div>
        )}
        {formePreavis === 'JOUR_HEURE' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor={`${idBase}-jour`}>Jour</label>
              <select
                id={`${idBase}-jour`}
                value={jour}
                onChange={(e) => {
                  setJour(e.target.value as Jour);
                }}
                style={{ width: '100%' }}
              >
                {JOURS.map((j) => (
                  <option key={j} value={j}>
                    {j.charAt(0) + j.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor={`${idBase}-heure`}>Heure butoir</label>
              <input
                id={`${idBase}-heure`}
                type="time"
                required
                value={heure}
                onChange={(e) => {
                  setHeure(e.target.value);
                }}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
          Types proposés
        </legend>
        {MODES.map((m) => (
          <label
            key={m}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <input
              type="checkbox"
              checked={types.includes(m)}
              onChange={(e) => {
                basculerType(m, e.target.checked);
              }}
            />
            {LIBELLES_MODE[m]}
          </label>
        ))}
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
          Coordonnées
        </legend>
        <label htmlFor={`${idBase}-adresse`}>Adresse</label>
        <input
          id={`${idBase}-adresse`}
          type="text"
          value={adresse}
          onChange={(e) => {
            setAdresse(e.target.value);
          }}
          style={{ width: '100%' }}
        />
        <label htmlFor={`${idBase}-telephone`}>Téléphone</label>
        <input
          id={`${idBase}-telephone`}
          type="tel"
          value={telephone}
          onChange={(e) => {
            setTelephone(e.target.value);
          }}
          style={{ width: '100%' }}
        />
        <label htmlFor={`${idBase}-contact`}>Personne à contacter</label>
        <input
          id={`${idBase}-contact`}
          type="text"
          value={contact}
          onChange={(e) => {
            setContact(e.target.value);
          }}
          style={{ width: '100%' }}
        />
      </fieldset>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button type="submit" className="btn" disabled={chargement}>
          {chargement
            ? edition
              ? 'Enregistrement…'
              : 'Création…'
            : edition
              ? 'Enregistrer les modifications'
              : 'Créer l’établissement'}
        </button>
        <button type="button" className="btn secondaire" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </form>
  );
}

// ---- Carte d'un établissement (affichage + actions) -------------------------

interface CarteEtablissementProps {
  etablissement: EtablissementFoyerVue;
  onModifier: () => void;
  onSupprimer: () => void;
  onBasculerActif: () => void;
  actionEnCours: boolean;
}

function CarteEtablissement({
  etablissement: e,
  onModifier,
  onSupprimer,
  onBasculerActif,
  actionEnCours,
}: CarteEtablissementProps) {
  const coordonnees = [e.adresse, e.telephone, e.contact].filter(
    (v): v is string => v != null && v !== '',
  );
  return (
    <section
      className="carte"
      style={{
        maxWidth: 600,
        marginBottom: '1rem',
        opacity: e.actif ? 1 : 0.6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '0.5rem',
        }}
      >
        <h2 style={{ margin: 0 }}>{e.nom}</h2>
        {!e.actif && <span className="muted">(archivé)</span>}
      </div>
      <p className="muted" style={{ margin: '0.25rem 0' }}>
        {e.emailService ?? 'aucune adresse e-mail'} — préavis :{' '}
        {decrirePreavis(e.preavisRegle)}
      </p>
      {e.types.length > 0 && (
        <p className="muted" style={{ margin: '0.25rem 0' }}>
          Types : {e.types.map(libelleType).join(', ')}
        </p>
      )}
      {coordonnees.length > 0 && (
        <p className="muted" style={{ margin: '0.25rem 0' }}>
          {coordonnees.join(' · ')}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          className="btn secondaire"
          onClick={onModifier}
          aria-label={`Modifier ${e.nom}`}
        >
          Modifier
        </button>
        <button
          type="button"
          className="btn secondaire"
          onClick={onBasculerActif}
          disabled={actionEnCours}
          aria-label={`${e.actif ? 'Archiver' : 'Réactiver'} ${e.nom}`}
        >
          {e.actif ? 'Archiver' : 'Réactiver'}
        </button>
        <button
          type="button"
          className="btn secondaire"
          onClick={onSupprimer}
          disabled={actionEnCours}
          aria-label={`Supprimer ${e.nom}`}
        >
          Supprimer
        </button>
      </div>
    </section>
  );
}

// ---- Page -------------------------------------------------------------------

/**
 * Écran de configuration des **établissements du foyer** (entité libre, P4).
 * Per-foyer (route `/foyers/:foyerId/etablissements`, sous `GardeFoyer`) : liste,
 * création, édition (nom / e-mail / préavis / types / coordonnées), archivage et
 * suppression (bloquée 409 si des contrats y sont rattachés → message dédié).
 */
export function EtablissementsPage() {
  useTitrePage('Établissements');
  const { foyerId } = useParams<{ foyerId: string }>();
  const id = foyerId ?? '';
  const { data, loading, error, reload } = useEtablissements(id);

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [etablissementEdite, setEtablissementEdite] =
    useState<EtablissementFoyerVue | null>(null);
  const [aSupprimer, setASupprimer] = useState<EtablissementFoyerVue | null>(
    null,
  );
  const [actionId, setActionId] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [messageSucces, setMessageSucces] = useState<string | null>(null);

  function ouvrirCreation() {
    setEtablissementEdite(null);
    setErreurAction(null);
    setMessageSucces(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(e: EtablissementFoyerVue) {
    setEtablissementEdite(e);
    setErreurAction(null);
    setMessageSucces(null);
    setFormulaireOuvert(true);
  }

  function fermerFormulaire() {
    setFormulaireOuvert(false);
    setEtablissementEdite(null);
  }

  function onEnregistre(e: EtablissementFoyerVue) {
    setMessageSucces(
      etablissementEdite
        ? `Établissement « ${e.nom} » modifié.`
        : `Établissement « ${e.nom} » créé.`,
    );
    reload();
    fermerFormulaire();
  }

  async function basculerActif(e: EtablissementFoyerVue) {
    setActionId(e.id);
    setErreurAction(null);
    setMessageSucces(null);
    try {
      await api.modifierEtablissement(id, e.id, { actif: !e.actif });
      setMessageSucces(
        e.actif
          ? `Établissement « ${e.nom} » archivé.`
          : `Établissement « ${e.nom} » réactivé.`,
      );
      reload();
    } catch (err) {
      setErreurAction(messageErreur(err));
    } finally {
      setActionId(null);
    }
  }

  async function confirmerSuppression() {
    const e = aSupprimer;
    if (!e) return;
    setASupprimer(null);
    setActionId(e.id);
    setErreurAction(null);
    setMessageSucces(null);
    try {
      await api.supprimerEtablissement(id, e.id);
      setMessageSucces(`Établissement « ${e.nom} » supprimé.`);
      reload();
    } catch (err) {
      // 409 : des contrats sont rattachés — message explicite (et non technique).
      if (err instanceof ApiError && err.status === 409) {
        setErreurAction(
          `Impossible de supprimer « ${e.nom} » : des contrats y sont rattachés. Réaffectez-les ou supprimez-les d’abord.`,
        );
      } else {
        setErreurAction(messageErreur(err));
      }
    } finally {
      setActionId(null);
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Établissements de la famille</h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link to={`/foyers/${id}/contrats`} className="btn secondaire">
            Contrats
          </Link>
          <Link to={`/foyers/${id}/planning`} className="btn secondaire">
            Planning
          </Link>
        </div>
      </div>
      <p className="muted">
        Les établissements destinataires des récapitulatifs (crèche, école,
        périscolaire…). Chaque contrat est rattaché à l’un d’eux.
      </p>

      {erreurAction && (
        <p className="debit" role="alert">
          {erreurAction}
        </p>
      )}
      <div role="status" aria-live="polite">
        {messageSucces && <p className="credit">{messageSucces}</p>}
      </div>

      {loading && !data && (
        <div className="carte muted" aria-live="polite">
          Chargement des établissements…
        </div>
      )}

      {!loading && error && !data && (
        <div className="carte" role="alert">
          <p style={{ color: 'var(--rouge)', margin: '0 0 0.5rem' }}>{error}</p>
          <button type="button" className="btn secondaire" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {data?.map((e) => (
        <CarteEtablissement
          key={e.id}
          etablissement={e}
          onModifier={() => {
            ouvrirEdition(e);
          }}
          onSupprimer={() => {
            setASupprimer(e);
          }}
          onBasculerActif={() => {
            void basculerActif(e);
          }}
          actionEnCours={actionId === e.id}
        />
      ))}

      {!loading && !error && data?.length === 0 && (
        <div className="carte muted">Aucun établissement configuré.</div>
      )}

      <section style={{ marginTop: '1rem' }}>
        {!formulaireOuvert ? (
          <button
            type="button"
            className="btn"
            onClick={ouvrirCreation}
            disabled={!id}
          >
            + Nouvel établissement
          </button>
        ) : (
          <div className="carte" style={{ maxWidth: 600 }}>
            <h2 style={{ marginTop: 0 }}>
              {etablissementEdite
                ? 'Modifier l’établissement'
                : 'Nouvel établissement'}
            </h2>
            <EtablissementForm
              foyerId={id}
              {...(etablissementEdite
                ? { etablissement: etablissementEdite }
                : {})}
              onEnregistre={onEnregistre}
              onAnnuler={fermerFormulaire}
            />
          </div>
        )}
      </section>

      <ModaleConfirmation
        ouvert={aSupprimer !== null}
        titre="Supprimer l’établissement"
        message={
          aSupprimer
            ? `L’établissement « ${aSupprimer.nom} » sera définitivement supprimé. La suppression est refusée si des contrats y sont encore rattachés.`
            : ''
        }
        libelleConfirmer="Supprimer l’établissement"
        destructif
        onConfirmer={() => void confirmerSuppression()}
        onAnnuler={() => {
          setASupprimer(null);
        }}
      />
    </div>
  );
}
