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
import { ChargementPage } from '../ui/ChargementPage';
import { Bouton } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';
import { ChampFormulaire } from '../ui/ChampFormulaire';
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
/**
 * WCAG 2.2 — SC 3.3.7 « Saisie redondante », A.
 *
 * `emailConnu` est l'adresse **vérifiée** de la personne qui remplit le
 * formulaire (identité Cloudflare Access, `GET /api/v1/moi`). Le service la
 * connaît déjà : la redemander est très exactement la saisie redondante que ce
 * critère interdit. Et l'enjeu dépasse le confort — `moi.foyers` est résolu
 * côté serveur en cherchant les lignes parent qui portent cette adresse : une
 * ligne parent absente ou mal orthographiée fait créer un foyer dont son propre
 * auteur n'est **pas** parent, donc qu'il ne retrouve pas en mode borné.
 * Le champ reste modifiable (l'auteur peut inscrire l'autre parent).
 *
 * L'identité vérifiée **prime sur l'e-mail de démonstration** : elle n'est pas
 * une donnée fictive, et c'est le seul agencement qui rende la règle observable
 * hors d'un build de production — `DEMO` vaut vrai en test comme sous `vite
 * serve`, donc un pré-remplissage réservé à `!DEMO` n'aurait été exercé par
 * aucune suite du dépôt.
 *
 * ⚠️ **`estMaPremiereFamille` n'est pas un raffinement, c'est la condition du
 * critère.** La saisie redondante suppose que l'adresse redemandée soit celle de
 * la personne **qui va être parent** du foyer créé. Or cet écran sert aussi au
 * provisionnement : `moi.admin` est permissif tant que le gating `ADMIN_EMAILS`
 * est inactif, donc « Nouvelle famille » est proposé à qui a déjà un foyer, pour
 * en créer un à **une autre famille**. Une ligne parent pré-remplie y serait
 * toujours non vide, donc toujours envoyée (le formulaire ne filtre que les
 * lignes entièrement vides) : l'auteur deviendrait parent du foyer d'autrui —
 * accès `@FoyerScope` accordé, et récap du mardi reçu, `VALIDATION_HEBDO/EMAIL`
 * étant actif par défaut. On ne pré-remplit donc que la **première création**,
 * celle où l'auteur est nécessairement le parent.
 */
function defautParents(emailConnu: string | null): EtatParent[] {
  const email = emailConnu ?? (DEMO ? 'parent.demo@example.com' : '');
  return DEMO
    ? [nouveauParent(email, 'Camille', 'Martin')]
    : [nouveauParent(email)];
}

/**
 * Attend la résolution de l'identité avant de monter le formulaire : c'est elle
 * qui pré-remplit la ligne parent (SC 3.3.7), et l'état de saisie s'initialise
 * une seule fois, au montage. Monter le formulaire d'abord obligerait à écrire
 * dans l'état depuis un effet — la valeur arriverait après une frappe possible.
 */
export function FoyerFormPage() {
  useTitrePage('Créer ma famille');
  const moi = useMoi();
  if (moi.loading) {
    return <ChargementPage message="Chargement de votre session…" />;
  }
  return <FormulaireCreationFoyer />;
}

function FormulaireCreationFoyer() {
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
  // SC 3.3.7 : seule la PREMIÈRE création pré-remplit (cf. `defautParents`) —
  // au-delà, cet écran sert à provisionner le foyer d'une autre famille.
  const estMaPremiereFamille = moi.foyers.length === 0;
  const [parents, setParents] = useState<EtatParent[]>(() =>
    defautParents(estMaPremiereFamille ? moi.email : null),
  );
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
      // Fraîcheur de session (lot 3) : invalide et relance `/api/v1/moi` pour
      // que `moi.foyers` inclue immédiatement le foyer créé. Sans cela, revenir
      // à l'accueil réafficherait « Vous n'avez pas encore de foyer ».
      // `recharger` est synchrone (il relance en arrière-plan) : pas d'`await`.
      moi.recharger();
      // react-router v7 : `navigate` renvoie une Promise ; navigation
      // fire-and-forget (on n'attend pas la transition), d'où le `void`.
      void navigate(`/foyers/${dossier.foyer.id}/contrats`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // P5 (create-once) : le BFF refuse une 2ᵉ création. Oriente vers l'édition
        // (l'écran masque normalement le formulaire en amont ; filet pour une
        // course où `moi.foyers` était encore vide au montage).
        setErreurGlobale(
          'Vous avez déjà une famille. Modifiez-la plutôt que d’en créer une nouvelle.',
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
        titre="Vous avez déjà une famille"
        description="Vous ne pouvez créer qu'une seule famille. Modifiez la vôtre plutôt que d'en créer une nouvelle."
        actions={[
          {
            libelle: 'Voir ma famille',
            href: `/foyers/${premierFoyer}/modifier`,
            primaire: true,
          },
        ]}
      />
    );
  }

  return (
    <div className="carte page-etroite">
      <h1 className="mt-0">Créer ma famille</h1>

      {/* Onboarding guidé (lot 3) : dire d'entrée ce qu'on construit, avant les
          champs — le formaire raconte enfants → parents → ressources. */}
      <p className="muted mt-0">
        Votre famille regroupe vos enfants, les parents qui suivent leur garde,
        et vos ressources pour estimer les tarifs.
      </p>

      <ChampErreur balise="p" focalisable ref={refErreurGlobale}>
        {erreurGlobale}
      </ChampErreur>

      <form onSubmit={(ev) => void soumettre(ev)}>
        <fieldset className="bloc-champs" style={{ margin: 0 }}>
          <legend>Enfants</legend>

          {enfants.map((enfant) => (
            <div
              key={enfant.id}
              className="carte enfant-ligne mb-2"
              style={{
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
                  className="champ-large"
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
                  className="champ-large"
                />
              </div>
              {enfants.length > 1 && (
                <Bouton
                  variante="secondaire"
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
                </Bouton>
              )}
            </div>
          ))}

          <Bouton
            variante="secondaire"
            onClick={ajouterEnfant}
            className="mt-1"
          >
            + Ajouter un enfant
          </Bouton>
        </fieldset>

        <fieldset className="bloc-champs" style={{ margin: '1rem 0 0' }}>
          {/* `.bloc-champs > legend` pose déjà `font-weight: 600` ; la marge
              basse reste inline car elle vaut 0.25rem, pas le 0.5rem du bloc. */}
          <legend style={{ marginBottom: '0.25rem' }}>Parents</legend>
          <p className="muted mt-0">
            Chaque parent recevra les récapitulatifs hebdomadaires et pourra
            accéder à l&apos;application avec son adresse e-mail.
          </p>

          {parents.map((parent) => {
            const champEmail = `parent.${parent.id}.email`;
            const nomComplet =
              `${parent.prenom.trim()} ${parent.nom.trim()}`.trim();
            const designation = nomComplet || parent.email.trim();
            return (
              <div key={parent.id} className="carte parent-ligne mb-2">
                <ChampFormulaire
                  id={`parent-email-${parent.id}`}
                  libelle={
                    <>
                      Adresse e-mail <span aria-hidden="true">*</span>
                    </>
                  }
                  requis
                  erreur={erreurPour(champEmail) ?? null}
                  idErreur={idErreur(champEmail)}
                >
                  {/* Pas d'attribut `required` HTML : le bloc Parents est
                      facultatif (un foyer peut être créé sans parent, la ligne
                      vide par défaut est ignorée). L'e-mail reste obligatoire
                      *pour un parent renseigné* — `aria-required` l'annonce et
                      le BFF le valide, l'erreur étant reliée via
                      `aria-describedby`. */}
                  {(champ) => (
                    <input
                      {...champ}
                      type="email"
                      value={parent.email}
                      onChange={(e) => {
                        mettreAJourParent(parent.id, 'email', e.target.value);
                      }}
                      className="champ-large"
                    />
                  )}
                </ChampFormulaire>

                <div className="champs-duo mt-2">
                  <div>
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
                      className="champ-large"
                    />
                  </div>
                  <div>
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
                      className="champ-large"
                    />
                  </div>
                </div>

                <Bouton
                  variante="secondaire"
                  onClick={() => {
                    supprimerParent(parent.id);
                  }}
                  aria-label={
                    designation
                      ? `Retirer le parent ${designation}`
                      : 'Retirer ce parent'
                  }
                  className="mt-2"
                >
                  Retirer
                </Bouton>
              </div>
            );
          })}

          <Bouton
            variante="secondaire"
            onClick={ajouterParent}
            className="mt-1"
          >
            + Ajouter un parent
          </Bouton>
        </fieldset>

        {/* Ressources en dernier (lot 3) : après les enfants et les parents,
            avec l'explication (barème CAF) portée par le composant partagé. */}
        <div style={{ margin: '1rem 0 0' }}>
          <FoyerScalairesForm
            valeurs={scalaires}
            onChange={setScalaire}
            erreurPour={erreurPour}
            idErreur={idErreur}
          />
        </div>

        <div className="mt-5">
          <Bouton type="submit" disabled={chargement}>
            {chargement ? 'Création en cours…' : 'Créer ma famille'}
          </Bouton>
        </div>
      </form>
    </div>
  );
}
