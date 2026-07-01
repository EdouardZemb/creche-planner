import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import {
  extraireErreurs,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { useTitrePage } from '../hooks/useTitrePage';
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
  { canal: 'EMAIL', libelle: 'E-mail' },
  { canal: 'IN_APP', libelle: 'Dans l’application' },
];

interface TypeMeta {
  readonly type: TypeNotification;
  readonly libelle: string;
  readonly description: string;
  /** Type **de service** : au moins un canal doit rester actif (verrou UI + API). */
  readonly service: boolean;
}

const TYPES: readonly TypeMeta[] = [
  {
    type: 'VALIDATION_HEBDO',
    libelle: 'Validation hebdomadaire',
    description:
      'Le rappel du mardi pour valider les besoins de la semaine suivante.',
    service: true,
  },
];

/** Clé stable d'une case type × canal dans l'état local. */
function cle(type: string, canal: string): string {
  return `${type}:${canal}`;
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

// ---- Bloc « Notifications » (tableau type × canal) --------------------------

function BlocNotifications({ profil }: { readonly profil: MonProfilVue }) {
  const [etat, setEtat] = useState<Record<string, boolean>>(() =>
    construireEtat(profil.preferences),
  );
  // Case en cours d'écriture (clé type×canal) : désactive la case le temps de l'aller-retour.
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const refErreur = useRef<HTMLParagraphElement>(null);

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
    setSucces(null);
    setEnCours(k);
    try {
      const maj = await api.majPreferences({
        preferences: [{ typeNotification: type, canal, actif: nouvelleValeur }],
      });
      setEtat(construireEtat(maj)); // resync sur l'état effectif serveur
      setSucces('Préférences enregistrées.');
    } catch (err) {
      setEtat(precedent); // rollback
      if (err instanceof ApiError && err.status === 400) {
        setErreur(
          'Ce canal ne peut pas être coupé : au moins un canal doit rester actif pour cette notification de service.',
        );
      } else {
        setErreur(messageErreur(err));
      }
    } finally {
      setEnCours(null);
    }
  }

  return (
    <section
      className="carte"
      style={{ maxWidth: 600 }}
      aria-labelledby="notif-titre"
    >
      <h2 id="notif-titre" style={{ marginTop: 0 }}>
        Notifications
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Choisissez comment vous souhaitez être prévenu. Une notification de
        service garde toujours au moins un canal actif.
      </p>

      {erreur && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreur}>
          {erreur}
        </p>
      )}
      <div role="status" aria-live="polite">
        {succes && <p className="credit">{succes}</p>}
      </div>

      {TYPES.map((t) => {
        const actifs = nbCanauxActifs(etat, t.type);
        return (
          <fieldset
            key={t.type}
            style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}
          >
            <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              {t.libelle}
            </legend>
            <p className="muted" style={{ marginTop: 0 }}>
              {t.description}
            </p>
            {CANAUX.map((c) => {
              const k = cle(t.type, c.canal);
              const actif = etat[k] ?? false;
              // Dernier canal actif d'un type de service → verrouillé.
              const verrou = t.service && actif && actifs <= 1;
              const idAide = `${k}-aide`;
              return (
                <div key={c.canal} style={{ marginTop: '0.25rem' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
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
                    <span
                      id={idAide}
                      className="muted"
                      style={{
                        display: 'block',
                        marginLeft: '1.5rem',
                        fontSize: '0.85em',
                      }}
                    >
                      Dernier canal actif : il ne peut pas être désactivé pour
                      cette notification de service.
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        );
      })}
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
  const [succes, setSucces] = useState<string | null>(null);
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
    setSucces(null);
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
      setSucces('Profil enregistré.');
    } catch (err) {
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

  return (
    <section
      className="carte"
      style={{ maxWidth: 600 }}
      aria-labelledby="identite-titre"
    >
      <h2 id="identite-titre" style={{ marginTop: 0 }}>
        Mes informations
      </h2>

      {erreurGlobale && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreur}>
          {erreurGlobale}
        </p>
      )}
      <div role="status" aria-live="polite">
        {succes && <p className="credit">{succes}</p>}
      </div>

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
        style={{ width: '100%' }}
      />
      {erreurPour('email') && (
        <span id={idErreur('email')} className="debit" role="alert">
          {erreurPour('email')}
        </span>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <div style={{ flex: 1 }}>
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
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ flex: 1 }}>
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
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {profil.principal && (
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Vous êtes le parent principal (destinataire « À » par défaut).
        </p>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className="btn"
          disabled={occupe}
          onClick={() => void enregistrer()}
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
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
        <div className="carte muted" aria-live="polite">
          Chargement de votre profil…
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

      {data && (
        <>
          <BlocIdentite profil={data} />
          <BlocNotifications profil={data} />
        </>
      )}
    </div>
  );
}
