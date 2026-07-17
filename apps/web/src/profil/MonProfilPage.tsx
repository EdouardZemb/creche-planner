import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import {
  extraireErreurs,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { useTitrePage } from '../hooks/useTitrePage';
import { useAnnonce } from '../hooks/useAnnonce';
import { StatutSauvegarde, type EtatSauvegarde } from '../ui/StatutSauvegarde';
import { ChargementPage } from '../ui/ChargementPage';
import type {
  CanalNotification,
  MonProfilVue,
  PreferenceVue,
  TypeNotification,
} from '../types/bff';
import { useMonProfil } from './useMonProfil';

// ---- Catalogue des préférences affichées -----------------------------------
//
// On n'expose que les types **préférençables par le parent**. `RECAP_SERVICE`
// (sortant vers l'établissement) part quoi qu'il arrive et n'est donc pas
// présenté ici (cf. plan §5.1). L'absence de ligne côté API = défaut applicatif
// « tout actif » (§5.1) : on initialise à `true` puis on écrase avec l'état
// effectif renvoyé par `GET /moi/profil`.

interface CanalMeta {
  readonly canal: CanalNotification;
  readonly libelle: string;
}

const CANAUX: readonly CanalMeta[] = [
  { canal: 'EMAIL', libelle: 'Par e-mail' },
  { canal: 'IN_APP', libelle: 'Dans l’application' },
];

interface TypeMeta {
  readonly type: TypeNotification;
  /** Type **de service** : au moins un canal doit rester actif (verrou UI + API). */
  readonly service: boolean;
}

const TYPES: readonly TypeMeta[] = [
  { type: 'VALIDATION_HEBDO', service: true },
];

/** Clé stable d'une case type × canal dans l'état local. */
function cle(type: string, canal: string): string {
  return `${type}:${canal}`;
}

/** Heure locale « 21:43 » posée dans le statut d'un enregistrement réussi. */
function heureCourante(): string {
  return new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Sujet d'annonce (lecteur d'écran) selon le canal basculé. */
const SUJET_ANNONCE: Record<CanalNotification, string> = {
  EMAIL: 'E-mail',
  IN_APP: 'Rappel dans l’application',
};

/** Message annoncé après resync : « E-mail activé », « … désactivé », etc. */
function libelleAnnonce(canal: CanalNotification, actif: boolean): string {
  return `${SUJET_ANNONCE[canal]} ${actif ? 'activé' : 'désactivé'}`;
}

/**
 * État affiché des cases : défaut applicatif « tout actif » pour les combos du
 * catalogue, écrasé par les préférences effectives renvoyées par l'API (on
 * n'écrase que les combos affichés, les autres types sont ignorés).
 */
function construireEtat(
  prefs: readonly PreferenceVue[],
): Record<string, boolean> {
  const etat: Record<string, boolean> = {};
  for (const t of TYPES) {
    for (const c of CANAUX) {
      etat[cle(t.type, c.canal)] = true;
    }
  }
  for (const p of prefs) {
    const k = cle(p.typeNotification, p.canal);
    if (k in etat) etat[k] = p.actif;
  }
  return etat;
}

/** Nombre de canaux actifs pour un type (sert au verrou « dernier canal »). */
function nbCanauxActifs(etat: Record<string, boolean>, type: string): number {
  return CANAUX.filter((c) => etat[cle(type, c.canal)]).length;
}

// ---- Bloc « Le rappel du mardi » (question parent, e-mail / application) -----

function BlocNotifications({ profil }: { readonly profil: MonProfilVue }) {
  const [etat, setEtat] = useState<Record<string, boolean>>(() =>
    construireEtat(profil.preferences),
  );
  // Case en cours d'écriture (clé type×canal) : désactive la case le temps de l'aller-retour.
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const refErreur = useRef<HTMLParagraphElement>(null);
  const { annoncer, regionLiveProps } = useAnnonce();

  // a11y : porte le focus sur l'erreur globale dès qu'elle apparaît.
  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  async function basculer(
    type: TypeNotification,
    canal: CanalNotification,
    nouvelleValeur: boolean,
  ) {
    const meta = TYPES.find((t) => t.type === type);
    // Garde-fou UI : ne jamais couper le dernier canal d'un type de service
    // (la case est déjà `disabled`, ceci couvre un double-clic concurrent).
    if (!nouvelleValeur && meta?.service && nbCanauxActifs(etat, type) <= 1) {
      return;
    }

    const k = cle(type, canal);
    const precedent = etat;
    setEtat({ ...etat, [k]: nouvelleValeur }); // feedback optimiste
    setErreur(null);
    setEnCours(k);
    try {
      const maj = await api.majPreferences({
        preferences: [{ typeNotification: type, canal, actif: nouvelleValeur }],
      });
      setEtat(construireEtat(maj)); // resync sur l'état effectif serveur
      setEnregistreA(heureCourante());
      setEtatSauvegarde('enregistre');
      annoncer(libelleAnnonce(canal, nouvelleValeur));
    } catch (err) {
      setEtat(precedent); // rollback
      setEtatSauvegarde('erreur');
      if (err instanceof ApiError && err.status === 400) {
        setErreur(
          'Impossible de tout couper : gardez au moins un moyen d’être prévenu·e (e-mail ou application).',
        );
      } else {
        setErreur(messageErreur(err));
      }
    } finally {
      setEnCours(null);
    }
  }

  // Statut affiché : « en-cours » tant qu'une écriture est en vol, sinon le
  // dernier état atteint (persiste après succès/échec) — cf. `ParentsSection`.
  const etatAffiche: EtatSauvegarde =
    enCours !== null ? 'en-cours' : etatSauvegarde;

  return (
    <section className="carte page-etroite" aria-labelledby="notif-titre">
      <h2 id="notif-titre" className="profil-titre">
        Le rappel du mardi
      </h2>

      {erreur && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreur}>
          {erreur}
        </p>
      )}

      {TYPES.map((t) => {
        const actifs = nbCanauxActifs(etat, t.type);
        // Trace RGPD : si l'e-mail a été désactivé par lien one-click, on le
        // rappelle sous la case « Par e-mail » (`consentementAt` non affiché).
        const prefEmail = profil.preferences.find(
          (p) => p.typeNotification === t.type && p.canal === 'EMAIL',
        );
        const desabonneLe = prefEmail?.desabonneAt ?? null;
        return (
          <fieldset key={t.type} className="profil-fieldset">
            <legend>Comment souhaitez-vous être prévenu·e ?</legend>
            <p className="muted profil-intro">
              Chaque mardi, un rappel vous invite à valider les besoins de la
              semaine suivante.
            </p>
            {CANAUX.map((c) => {
              const k = cle(t.type, c.canal);
              const actif = etat[k] ?? false;
              // Dernier moyen actif d'un type de service → verrouillé.
              const verrou = t.service && actif && actifs <= 1;
              const idAide = `${k}-aide`;
              return (
                <div key={c.canal} className="profil-canal">
                  <label className="case-cochable">
                    <input
                      type="checkbox"
                      checked={actif}
                      disabled={verrou || enCours === k}
                      {...(verrou ? { 'aria-describedby': idAide } : {})}
                      onChange={(e) => {
                        void basculer(t.type, c.canal, e.target.checked);
                      }}
                    />
                    {c.libelle}
                  </label>
                  {verrou && (
                    <span id={idAide} className="muted profil-canal-aide">
                      Gardez au moins un moyen d’être prévenu·e : celui-ci reste
                      actif.
                    </span>
                  )}
                  {c.canal === 'EMAIL' && desabonneLe !== null && (
                    <span className="muted profil-canal-aide">
                      E-mail désactivé le{' '}
                      {new Date(desabonneLe).toLocaleDateString('fr-FR')}.
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        );
      })}

      <div className="actions-ligne">
        <StatutSauvegarde etat={etatAffiche} enregistreA={enregistreA} />
      </div>
      <p {...regionLiveProps} className="sr-only" />
    </section>
  );
}

// ---- Bloc « Identité » (ma ligne parent, restreinte à moi) ------------------

function BlocIdentite({ profil }: { readonly profil: MonProfilVue }) {
  const idBase = useId();
  const [email, setEmail] = useState(profil.email);
  const [prenom, setPrenom] = useState(profil.prenom ?? '');
  const [nom, setNom] = useState(profil.nom ?? '');
  const [occupe, setOccupe] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const refErreur = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (erreurGlobale) refErreur.current?.focus();
  }, [erreurGlobale]);

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  async function enregistrer() {
    setOccupe(true);
    setErreurGlobale(null);
    setErreursChamps([]);
    try {
      // Réutilise l'édition parent existante (PUT /foyers/:id/parents/:parentId,
      // gardée @FoyerScope). On conserve le statut `principal` tel quel : ce
      // n'est pas un champ de « Mon profil » (édition email/prénom/nom).
      const maj = await api.modifierParent(profil.foyerId, profil.parentId, {
        email: email.trim(),
        prenom: prenom.trim() === '' ? null : prenom.trim(),
        nom: nom.trim() === '' ? null : nom.trim(),
        principal: profil.principal,
      });
      setEmail(maj.email);
      setPrenom(maj.prenom ?? '');
      setNom(maj.nom ?? '');
      setEnregistreA(heureCourante());
      setEtatSauvegarde('enregistre');
    } catch (err) {
      setEtatSauvegarde('erreur');
      if (err instanceof ApiError) {
        const erreurs = extraireErreurs(err.corps);
        if (erreurs.length > 0) {
          setErreursChamps(erreurs);
          return;
        }
        if (err.status === 409) {
          setErreurGlobale('Adresse e-mail déjà utilisée.');
          return;
        }
      }
      setErreurGlobale(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  }

  const etatAffiche: EtatSauvegarde = occupe ? 'en-cours' : etatSauvegarde;

  return (
    <section
      className="carte page-etroite profil-form"
      aria-labelledby="identite-titre"
    >
      <h2 id="identite-titre" className="profil-titre">
        Mes informations
      </h2>

      {erreurGlobale && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreur}>
          {erreurGlobale}
        </p>
      )}

      <label htmlFor={`${idBase}-email`}>
        Adresse e-mail <span aria-hidden="true">*</span>
      </label>
      <input
        id={`${idBase}-email`}
        type="email"
        aria-required="true"
        aria-invalid={erreurPour('email') ? true : undefined}
        {...(erreurPour('email')
          ? { 'aria-describedby': idErreur('email') }
          : {})}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
      />
      {erreurPour('email') && (
        <span id={idErreur('email')} className="debit" role="alert">
          {erreurPour('email')}
        </span>
      )}

      <div className="champs-duo">
        <div>
          <label htmlFor={`${idBase}-prenom`}>
            Prénom <span className="muted">(facultatif)</span>
          </label>
          <input
            id={`${idBase}-prenom`}
            type="text"
            value={prenom}
            onChange={(e) => {
              setPrenom(e.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor={`${idBase}-nom`}>
            Nom <span className="muted">(facultatif)</span>
          </label>
          <input
            id={`${idBase}-nom`}
            type="text"
            value={nom}
            onChange={(e) => {
              setNom(e.target.value);
            }}
          />
        </div>
      </div>

      {profil.principal && (
        <p className="muted profil-note">
          Vous êtes le parent principal (destinataire « À » par défaut).
        </p>
      )}

      <div className="actions-ligne">
        <button
          type="button"
          className="btn"
          disabled={occupe}
          onClick={() => void enregistrer()}
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <StatutSauvegarde etat={etatAffiche} enregistreA={enregistreA} />
      </div>
    </section>
  );
}

// ---- Page -------------------------------------------------------------------

/**
 * Page « Mon profil » (A1) : le parent connecté édite ses informations (e-mail,
 * prénom, nom — sa **seule** ligne, résolue serveur depuis l'identité) et règle
 * ses préférences de notification (type × canal). Route `/mon-profil`, hors
 * `GardeFoyer` (non bornée par une URL de foyer). Data-fetching `useAsync`.
 */
export function MonProfilPage() {
  useTitrePage('Mon profil');
  const { data, loading, error, reload } = useMonProfil();

  return (
    <div>
      <h1>Mon profil</h1>

      {loading && !data && (
        <ChargementPage message="Chargement de votre profil…" />
      )}

      {!loading && error && !data && (
        <div className="carte" role="alert">
          <p className="debit profil-erreur">{error}</p>
          <button type="button" className="btn secondaire" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {data && (
        <>
          <BlocIdentite profil={data} />
          <BlocNotifications profil={data} />
        </>
      )}
    </div>
  );
}
