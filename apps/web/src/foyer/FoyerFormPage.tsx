import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { setFoyerId } from '../utils/store';
import { useTitrePage } from '../hooks/useTitrePage';
import {
  extraireErreurs,
  focaliserSection,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import { EtatVide } from '../ui/EtatVide';
import { useMoi } from '../session/MoiContext';
import {
  FoyerScalairesForm,
  type ChampScalaireFoyer,
  type ValeursScalairesFoyer,
} from './FoyerScalairesForm';
import { retraduireErreurParent } from './parentErreurs';
import type { CreerEnfant, CreerParent } from '../types/bff';

interface EtatEnfant {
  /** Id stable pour la `key` React, indépendant de la position dans la liste. */
  id: string;
  prenom: string;
  dateNaissance: string;
}

let compteurEnfant = 0;
function nouvelEnfant(prenom = '', dateNaissance = ''): EtatEnfant {
  compteurEnfant += 1;
  return { id: `enfant-${compteurEnfant}`, prenom, dateNaissance };
}

interface EtatParent {
  /** Id stable pour la `key` React, indépendant de la position dans la liste. */
  id: string;
  email: string;
  prenom: string;
  nom: string;
}

let compteurParent = 0;
function nouveauParent(email = '', prenom = '', nom = ''): EtatParent {
  compteurParent += 1;
  return { id: `parent-${compteurParent}`, email, prenom, nom };
}

// Valeurs de démonstration : pré-remplissage actif hors build de production
// (`import.meta.env.PROD` vaut false en dev et en test). En production les
// champs restent vides pour ne pas suggérer de données fictives.
const DEMO = !import.meta.env.PROD;

const DEFAUT_RESSOURCES = DEMO ? '6716.92' : '';
const DEFAUT_RFR = DEMO ? '72705' : '';
const DEFAUT_NB_ENFANTS = DEMO ? '2' : '';
const DEFAUT_NB_PARTS = DEMO ? '2.5' : '';
function defautEnfants(): EtatEnfant[] {
  return DEMO
    ? [nouvelEnfant('Mia', '2024-12-08'), nouvelEnfant('Zoé', '2023-03-12')]
    : [nouvelEnfant()];
}
function defautParents(): EtatParent[] {
  return DEMO
    ? [nouveauParent('parent.demo@example.com', 'Camille', 'Martin')]
    : [nouveauParent()];
}

export function FoyerFormPage() {
  useTitrePage('Nouveau foyer');
  const navigate = useNavigate();
  const idBase = useId();
  const moi = useMoi();

  const [scalaires, setScalaires] = useState<ValeursScalairesFoyer>({
    ressourcesMensuelles: DEFAUT_RESSOURCES,
    rfr: DEFAUT_RFR,
    nbEnfantsACharge: DEFAUT_NB_ENFANTS,
    nbParts: DEFAUT_NB_PARTS,
  });
  const [enfants, setEnfants] = useState<EtatEnfant[]>(defautEnfants);
  const [parents, setParents] = useState<EtatParent[]>(defautParents);
  const [chargement, setChargement] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);
  // UT-04 : cible de focus de la première section concernée (l'alerte globale).
  const refErreurGlobale = useRef<HTMLParagraphElement>(null);

  // UT-04 (CA2) : à l'apparition d'une erreur globale (BFF sans détail par
  // champ), on porte le focus sur l'alerte plutôt que de rester muet.
  useEffect(() => {
    if (erreurGlobale) {
      focaliserSection(refErreurGlobale.current);
    }
  }, [erreurGlobale]);

  function setScalaire(champ: ChampScalaireFoyer, valeur: string) {
    setScalaires((prev) => ({ ...prev, [champ]: valeur }));
  }

  function ajouterEnfant() {
    setEnfants((prev) => [...prev, nouvelEnfant()]);
  }

  function supprimerEnfant(id: string) {
    setEnfants((prev) => prev.filter((e) => e.id !== id));
  }

  function mettreAJourEnfant(
    id: string,
    champ: 'prenom' | 'dateNaissance',
    valeur: string,
  ) {
    setEnfants((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [champ]: valeur } : e)),
    );
  }

  function ajouterParent() {
    setParents((prev) => [...prev, nouveauParent()]);
  }

  function supprimerParent(id: string) {
    setParents((prev) => prev.filter((p) => p.id !== id));
  }

  function mettreAJourParent(
    id: string,
    champ: 'email' | 'prenom' | 'nom',
    valeur: string,
  ) {
    setParents((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [champ]: valeur } : p)),
    );
  }

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

    const enfantsValides: CreerEnfant[] = enfants
      .filter((e) => e.prenom.trim() !== '' && e.dateNaissance !== '')
      .map((e) => ({
        prenom: e.prenom.trim(),
        dateNaissance: e.dateNaissance,
      }));

    // On envoie toute ligne « entamée » (un champ au moins renseigné), pour que le
    // BFF signale l'e-mail manquant/invalide d'un parent nommé plutôt que de le
    // perdre silencieusement. Les lignes entièrement vides (dont la ligne par
    // défaut) sont ignorées : les parents restent facultatifs.
    const parentsSaisis = parents.filter(
      (p) =>
        p.email.trim() !== '' || p.prenom.trim() !== '' || p.nom.trim() !== '',
    );
    const parentsValides: CreerParent[] = parentsSaisis.map((p, i) => ({
      email: p.email.trim(),
      ...(p.prenom.trim() ? { prenom: p.prenom.trim() } : {}),
      ...(p.nom.trim() ? { nom: p.nom.trim() } : {}),
      ordre: i,
    }));
    // Mémorise l'ordre d'envoi pour retraduire les erreurs serveur indexées
    // (`parents.<i>.<champ>`) vers la ligne d'origine (id stable, cf. mappage).
    const idsParentsEnvoyes = parentsSaisis.map((p) => p.id);

    try {
      const dossier = await api.creerFoyer({
        ressourcesMensuelles: parseFloat(scalaires.ressourcesMensuelles),
        rfr: parseFloat(scalaires.rfr),
        nbEnfantsACharge: parseInt(scalaires.nbEnfantsACharge, 10),
        nbParts: parseFloat(scalaires.nbParts),
        enfants: enfantsValides,
        parents: parentsValides,
      });
      setFoyerId(dossier.foyer.id);
      // react-router v7 : `navigate` renvoie une Promise ; navigation
      // fire-and-forget (on n'attend pas la transition), d'où le `void`.
      void navigate(`/foyers/${dossier.foyer.id}/contrats`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // P5 (create-once) : le BFF refuse une 2ᵉ création. Oriente vers l'édition
        // (l'écran masque normalement le formulaire en amont ; filet pour une
        // course où `moi.foyers` était encore vide au montage).
        setErreurGlobale(
          'Vous avez déjà un foyer. Modifiez-le plutôt que d’en créer un nouveau.',
        );
      } else if (err instanceof ApiError) {
        const erreurs = extraireErreurs(err.corps).map((e) =>
          retraduireErreurParent(e, idsParentsEnvoyes),
        );
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

  // P5 (besoin B) : self-service de la 1ʳᵉ création. Un non-admin SANS foyer peut
  // créer le sien ; un non-admin qui a DÉJÀ un foyer est orienté vers l'édition
  // (create-once — le BFF renvoie 409 en doublon). L'admin (et le mode hérité,
  // `moi.admin` permissif) crée normalement.
  const premierFoyer = moi.foyers[0];
  if (!moi.loading && !moi.admin && premierFoyer !== undefined) {
    return (
      <EtatVide
        titre="Vous avez déjà un foyer"
        description="Vous ne pouvez créer qu'un seul foyer. Modifiez le vôtre plutôt que d'en créer un nouveau."
        actions={[
          {
            libelle: 'Modifier mon foyer',
            href: `/foyers/${premierFoyer}/modifier`,
            primaire: true,
          },
        ]}
      />
    );
  }

  return (
    <div className="carte" style={{ maxWidth: 600 }}>
      <h1 style={{ marginTop: 0 }}>Nouveau foyer</h1>

      {erreurGlobale && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreurGlobale}>
          {erreurGlobale}
        </p>
      )}

      <form onSubmit={(ev) => void soumettre(ev)}>
        <FoyerScalairesForm
          valeurs={scalaires}
          onChange={setScalaire}
          erreurPour={erreurPour}
          idErreur={idErreur}
        />

        <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Enfants
          </legend>

          {enfants.map((enfant) => (
            <div
              key={enfant.id}
              className="carte enfant-ligne"
              style={{
                marginBottom: '0.5rem',
                display: 'flex',
                gap: '0.5rem',
              }}
            >
              <div style={{ flex: 1 }}>
                <label htmlFor={`enfant-prenom-${enfant.id}`}>
                  Prénom <span aria-hidden="true">*</span>
                </label>
                <input
                  id={`enfant-prenom-${enfant.id}`}
                  type="text"
                  required
                  aria-required="true"
                  value={enfant.prenom}
                  onChange={(e) => {
                    mettreAJourEnfant(enfant.id, 'prenom', e.target.value);
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor={`enfant-naissance-${enfant.id}`}>
                  Date de naissance <span aria-hidden="true">*</span>
                </label>
                <input
                  id={`enfant-naissance-${enfant.id}`}
                  type="date"
                  required
                  aria-required="true"
                  value={enfant.dateNaissance}
                  onChange={(e) => {
                    mettreAJourEnfant(
                      enfant.id,
                      'dateNaissance',
                      e.target.value,
                    );
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              {enfants.length > 1 && (
                <button
                  type="button"
                  className="btn secondaire"
                  onClick={() => {
                    supprimerEnfant(enfant.id);
                  }}
                  aria-label={
                    enfant.prenom.trim() !== ''
                      ? `Retirer l'enfant ${enfant.prenom.trim()}`
                      : 'Retirer cet enfant'
                  }
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Retirer
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="btn secondaire"
            onClick={ajouterEnfant}
            style={{ marginTop: '0.25rem' }}
          >
            + Ajouter un enfant
          </button>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            Parents
          </legend>
          <p className="muted" style={{ marginTop: 0 }}>
            Destinataires des récapitulatifs hebdomadaires. Au moins un parent
            est recommandé.
          </p>

          {parents.map((parent) => {
            const champEmail = `parent.${parent.id}.email`;
            const nomComplet =
              `${parent.prenom.trim()} ${parent.nom.trim()}`.trim();
            const designation = nomComplet || parent.email.trim();
            return (
              <div
                key={parent.id}
                className="carte parent-ligne"
                style={{ marginBottom: '0.5rem' }}
              >
                <label htmlFor={`parent-email-${parent.id}`}>
                  Adresse e-mail <span aria-hidden="true">*</span>
                </label>
                {/* Pas d'attribut `required` HTML : le bloc Parents est
                    facultatif (un foyer peut être créé sans parent, la ligne
                    vide par défaut est ignorée). L'e-mail reste obligatoire
                    *pour un parent renseigné* — `aria-required` l'annonce et le
                    BFF le valide, l'erreur étant reliée via `aria-describedby`. */}
                <input
                  id={`parent-email-${parent.id}`}
                  type="email"
                  aria-required="true"
                  aria-invalid={erreurPour(champEmail) ? true : undefined}
                  {...(erreurPour(champEmail)
                    ? { 'aria-describedby': idErreur(champEmail) }
                    : {})}
                  value={parent.email}
                  onChange={(e) => {
                    mettreAJourParent(parent.id, 'email', e.target.value);
                  }}
                  style={{ width: '100%' }}
                />
                {erreurPour(champEmail) && (
                  <span
                    id={idErreur(champEmail)}
                    className="debit"
                    role="alert"
                  >
                    {erreurPour(champEmail)}
                  </span>
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginTop: '0.5rem',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label htmlFor={`parent-prenom-${parent.id}`}>
                      Prénom <span className="muted">(facultatif)</span>
                    </label>
                    <input
                      id={`parent-prenom-${parent.id}`}
                      type="text"
                      value={parent.prenom}
                      onChange={(e) => {
                        mettreAJourParent(parent.id, 'prenom', e.target.value);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label htmlFor={`parent-nom-${parent.id}`}>
                      Nom <span className="muted">(facultatif)</span>
                    </label>
                    <input
                      id={`parent-nom-${parent.id}`}
                      type="text"
                      value={parent.nom}
                      onChange={(e) => {
                        mettreAJourParent(parent.id, 'nom', e.target.value);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn secondaire"
                  onClick={() => {
                    supprimerParent(parent.id);
                  }}
                  aria-label={
                    designation
                      ? `Retirer le parent ${designation}`
                      : 'Retirer ce parent'
                  }
                  style={{ marginTop: '0.5rem' }}
                >
                  Retirer
                </button>
              </div>
            );
          })}

          <button
            type="button"
            className="btn secondaire"
            onClick={ajouterParent}
            style={{ marginTop: '0.25rem' }}
          >
            + Ajouter un parent
          </button>
        </fieldset>

        <div style={{ marginTop: '1.5rem' }}>
          <button type="submit" className="btn" disabled={chargement}>
            {chargement ? 'Création en cours…' : 'Créer le foyer'}
          </button>
        </div>
      </form>
    </div>
  );
}
