import { type FormEvent, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type {
  CreerEtablissement,
  EtablissementFoyerVue,
  PreavisRegle,
} from '../types/bff';
import {
  extraireErreurs,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { useTitrePage } from '../hooks/useTitrePage';
import { EtatVide } from '../ui/EtatVide';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { ChargementPage } from '../ui/ChargementPage';
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

/** Forme du délai pilotée par les radios (« Aucun » → règle null). */
type FormePreavis = 'AUCUN' | 'JOURS_OUVRES' | 'JOUR_HEURE';

/** Heure « 12:00 » → « 12 h » ; « 09:30 » → « 9 h 30 » (langage parent). */
function formaterHeure(heure: string): string {
  const [h, m] = heure.split(':');
  const heures = Number(h ?? '0');
  if (m == null || Number(m) === 0) return `${heures} h`;
  return `${heures} h ${m}`;
}

/** Rend une règle de délai en phrase lisible (récap de la carte). */
function decrireDelai(regle: PreavisRegle): string {
  if (regle.type === 'JOURS_OUVRES') {
    return `${regle.valeur} jour${regle.valeur > 1 ? 's' : ''} ouvré${
      regle.valeur > 1 ? 's' : ''
    }`;
  }
  return `avant ${regle.jour.toLowerCase()} ${formaterHeure(regle.heure)}`;
}

// ---- Formulaire création / édition -----------------------------------------

interface EtablissementFormProps {
  foyerId: string;
  /** Crèche / école à éditer ; absent ⇒ mode création. */
  etablissement?: EtablissementFoyerVue;
  onEnregistre: (e: EtablissementFoyerVue) => void;
  onAnnuler: () => void;
}

/**
 * Formulaire d'une crèche / école (création ou édition) : nom (requis), e-mail de
 * la structure, délai pour prévenir (aucun / jours ouvrés / jour + heure) et
 * coordonnées. Les erreurs par champ remontées par le BFF sont liées en
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

  // Règle de délai existante, narrow une fois pour dériver les valeurs initiales.
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
  const [adresse, setAdresse] = useState(etablissement?.adresse ?? '');
  const [telephone, setTelephone] = useState(etablissement?.telephone ?? '');
  const [contact, setContact] = useState(etablissement?.contact ?? '');

  const [chargement, setChargement] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);

  const idAideEmail = `${idBase}-email-aide`;
  const idAideDelai = `${idBase}-delai-aide`;

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }
  /** `aria-describedby` de l'e-mail : aide toujours liée + erreur si présente. */
  function descriptionEmail(): string {
    const ids = [idAideEmail];
    if (erreurPour('emailService')) ids.push(idErreur('emailService'));
    return ids.join(' ');
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

    // Le champ `types` (modes proposés) n'est plus renseigné à l'écran ; on ne
    // l'envoie pas (le BFF le tolère, défaut `[]`).
    const corps: CreerEtablissement = {
      nom: nom.trim(),
      emailService: ouNull(emailService),
      preavisRegle: construirePreavis(),
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
    <form className="etab-form" onSubmit={(ev) => void soumettre(ev)}>
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
        Nom <span aria-hidden="true">*</span>
      </label>
      <input
        id={`${idBase}-nom`}
        type="text"
        required
        aria-required="true"
        placeholder="ex. Crèche du centre, École Jean Jaurès"
        aria-invalid={erreurPour('nom') ? true : undefined}
        {...(erreurPour('nom') ? { 'aria-describedby': idErreur('nom') } : {})}
        value={nom}
        onChange={(e) => {
          setNom(e.target.value);
        }}
      />
      {erreurPour('nom') && (
        <span id={idErreur('nom')} className="debit" role="alert">
          {erreurPour('nom')}
        </span>
      )}

      <label htmlFor={`${idBase}-email`}>E-mail de la crèche / école</label>
      <input
        id={`${idBase}-email`}
        type="email"
        aria-invalid={erreurPour('emailService') ? true : undefined}
        aria-describedby={descriptionEmail()}
        value={emailService}
        onChange={(e) => {
          setEmailService(e.target.value);
        }}
      />
      <span id={idAideEmail} className="muted etab-aide">
        C’est à cette adresse qu’on enverra le récapitulatif.
      </span>
      {erreurPour('emailService') && (
        <span id={idErreur('emailService')} className="debit" role="alert">
          {erreurPour('emailService')}
        </span>
      )}

      <fieldset className="etab-fieldset" aria-describedby={idAideDelai}>
        <legend>Délai pour prévenir</legend>
        <p id={idAideDelai} className="muted etab-aide">
          Combien de temps à l’avance la structure veut être prévenue d’un
          changement.
        </p>
        <label className="case-cochable">
          <input
            type="radio"
            name={`${idBase}-preavis`}
            checked={formePreavis === 'AUCUN'}
            onChange={() => {
              setFormePreavis('AUCUN');
            }}
          />
          Pas de délai particulier
        </label>
        <label className="case-cochable">
          <input
            type="radio"
            name={`${idBase}-preavis`}
            checked={formePreavis === 'JOURS_OUVRES'}
            onChange={() => {
              setFormePreavis('JOURS_OUVRES');
            }}
          />
          Un nombre de jours ouvrés
        </label>
        <label className="case-cochable">
          <input
            type="radio"
            name={`${idBase}-preavis`}
            checked={formePreavis === 'JOUR_HEURE'}
            onChange={() => {
              setFormePreavis('JOUR_HEURE');
            }}
          />
          Un jour et une heure limite
        </label>

        {formePreavis === 'JOURS_OUVRES' && (
          <div className="etab-sous-champ">
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
            />
          </div>
        )}
        {formePreavis === 'JOUR_HEURE' && (
          <div className="champs-duo etab-sous-champ">
            <div>
              <label htmlFor={`${idBase}-jour`}>Jour</label>
              <select
                id={`${idBase}-jour`}
                value={jour}
                onChange={(e) => {
                  setJour(e.target.value as Jour);
                }}
              >
                {JOURS.map((j) => (
                  <option key={j} value={j}>
                    {j.charAt(0) + j.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${idBase}-heure`}>Heure limite</label>
              <input
                id={`${idBase}-heure`}
                type="time"
                required
                value={heure}
                onChange={(e) => {
                  setHeure(e.target.value);
                }}
              />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="etab-fieldset">
        <legend>Coordonnées</legend>
        <label htmlFor={`${idBase}-adresse`}>Adresse</label>
        <input
          id={`${idBase}-adresse`}
          type="text"
          value={adresse}
          onChange={(e) => {
            setAdresse(e.target.value);
          }}
        />
        <label htmlFor={`${idBase}-telephone`}>Téléphone</label>
        <input
          id={`${idBase}-telephone`}
          type="tel"
          value={telephone}
          onChange={(e) => {
            setTelephone(e.target.value);
          }}
        />
        <label htmlFor={`${idBase}-contact`}>Personne à contacter</label>
        <input
          id={`${idBase}-contact`}
          type="text"
          value={contact}
          onChange={(e) => {
            setContact(e.target.value);
          }}
        />
      </fieldset>

      <div className="etab-form-actions">
        <button type="submit" className="btn" disabled={chargement}>
          {chargement
            ? edition
              ? 'Enregistrement…'
              : 'Ajout…'
            : edition
              ? 'Enregistrer les modifications'
              : 'Ajouter'}
        </button>
        <button type="button" className="btn secondaire" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </form>
  );
}

// ---- Carte d'une crèche / école (affichage + actions) -----------------------

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
  const sansEmail = e.emailService == null || e.emailService === '';
  return (
    <section
      className={
        e.actif
          ? 'carte etab-carte etab-carte-vue'
          : 'carte etab-carte etab-carte-vue est-archive'
      }
    >
      <div className="etab-carte-entete">
        <h2>{e.nom}</h2>
        {!e.actif && <span className="muted">(archivé)</span>}
      </div>

      {/* Angle mort « sans e-mail » : une crèche active sans adresse ne recevra
          jamais les récaps — on l'avertit clairement (aucun appel réseau, donnée
          déjà chargée). Une crèche archivée n'est de toute façon plus notifiée. */}
      {!sansEmail ? (
        <p className="muted">{e.emailService}</p>
      ) : e.actif ? (
        <p className="debit" role="note">
          <span aria-hidden="true">⚠️ </span>
          Sans e-mail, ce lieu d’accueil ne recevra pas les récapitulatifs.{' '}
          <span className="muted">Ajoutez son e-mail via « Modifier ».</span>
        </p>
      ) : null}

      {e.preavisRegle != null && (
        <p className="muted">
          Délai pour prévenir : {decrireDelai(e.preavisRegle)}
        </p>
      )}
      {coordonnees.length > 0 && (
        <p className="muted">{coordonnees.join(' · ')}</p>
      )}

      <div className="etab-actions">
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
          className="btn secondaire danger contour"
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
 * Écran « Crèches & écoles » du foyer (entité libre, P4). Per-foyer (route
 * `/foyers/:foyerId/etablissements`, sous `GardeFoyer`) : liste, création,
 * édition (nom / e-mail / délai / coordonnées), archivage et suppression
 * (bloquée 409 si des contrats y sont rattachés → message dédié).
 */
export function EtablissementsPage() {
  useTitrePage('Crèches & écoles');
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
        ? `Crèche / école « ${e.nom} » modifiée.`
        : `Crèche / école « ${e.nom} » ajoutée.`,
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
          ? `Crèche / école « ${e.nom} » archivée.`
          : `Crèche / école « ${e.nom} » réactivée.`,
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
      setMessageSucces(`Crèche / école « ${e.nom} » supprimée.`);
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

  const listeVide = !loading && !error && data?.length === 0;

  return (
    <div>
      <div className="etab-entete">
        <h1>Crèches & écoles</h1>
        <div className="etab-entete-liens">
          <Link to={`/foyers/${id}/contrats`} className="btn secondaire">
            Contrats
          </Link>
          <Link to={`/foyers/${id}/planning`} className="btn secondaire">
            Planning
          </Link>
        </div>
      </div>
      <p className="muted">
        Les lieux d’accueil de vos enfants (crèche, école, périscolaire…). C’est
        ici qu’on envoie le récapitulatif quand vous modifiez une semaine.
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
        <ChargementPage message="Chargement des crèches et écoles…" />
      )}

      {!loading && error && !data && (
        <div className="carte" role="alert">
          <p className="debit">{error}</p>
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

      {/* Foyer sans aucune crèche : accueil orienté action (l'action ouvre le
          formulaire inline). Masqué dès que le formulaire est ouvert pour ne pas
          doubler l'appel à l'action. */}
      {listeVide && !formulaireOuvert && (
        <EtatVide
          titre="Ajoutez votre première crèche ou école"
          description="Renseignez la crèche, l’école ou le périscolaire de vos enfants pour pouvoir les prévenir en un clic quand vous modifiez une semaine."
          actions={[
            {
              libelle: 'Ajouter une crèche / école',
              primaire: true,
              onClick: ouvrirCreation,
            },
          ]}
        />
      )}

      <section className="etab-ajout">
        {formulaireOuvert ? (
          <div className="carte etab-carte">
            <h2 className="etab-form-titre">
              {etablissementEdite ? 'Modifier' : 'Ajouter une crèche / école'}
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
        ) : (
          // L'accueil (EtatVide) porte déjà l'action quand la liste est vide.
          !listeVide && (
            <button
              type="button"
              className="btn"
              onClick={ouvrirCreation}
              disabled={!id}
            >
              Ajouter une crèche / école
            </button>
          )
        )}
      </section>

      <ModaleConfirmation
        ouvert={aSupprimer !== null}
        titre="Supprimer la crèche / école"
        message={
          aSupprimer
            ? `La crèche / école « ${aSupprimer.nom} » sera définitivement supprimée. La suppression est refusée si un contrat y est encore rattaché.`
            : ''
        }
        libelleConfirmer="Supprimer la crèche / école"
        destructif
        onConfirmer={() => void confirmerSuppression()}
        onAnnuler={() => {
          setASupprimer(null);
        }}
      />
    </div>
  );
}
