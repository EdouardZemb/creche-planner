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
import { Abbr } from '../ui/Abbr';
import type { CreerEnfant } from '../types/bff';

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

export function FoyerFormPage() {
  useTitrePage('Nouveau foyer');
  const navigate = useNavigate();
  const idBase = useId();

  const [ressourcesMensuelles, setRessourcesMensuelles] =
    useState(DEFAUT_RESSOURCES);
  const [rfr, setRfr] = useState(DEFAUT_RFR);
  const [nbEnfantsACharge, setNbEnfantsACharge] = useState(DEFAUT_NB_ENFANTS);
  const [nbParts, setNbParts] = useState(DEFAUT_NB_PARTS);
  const [enfants, setEnfants] = useState<EtatEnfant[]>(defautEnfants);
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

    try {
      const dossier = await api.creerFoyer({
        ressourcesMensuelles: parseFloat(ressourcesMensuelles),
        rfr: parseFloat(rfr),
        nbEnfantsACharge: parseInt(nbEnfantsACharge, 10),
        nbParts: parseFloat(nbParts),
        enfants: enfantsValides,
      });
      setFoyerId(dossier.foyer.id);
      navigate(`/foyers/${dossier.foyer.id}/contrats`);
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
    <div className="carte" style={{ maxWidth: 600 }}>
      <h1 style={{ marginTop: 0 }}>Nouveau foyer</h1>

      {erreurGlobale && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreurGlobale}>
          {erreurGlobale}
        </p>
      )}

      <form onSubmit={(ev) => void soumettre(ev)}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Ressources du foyer
          </legend>

          <label htmlFor="ressourcesMensuelles">
            Ressources mensuelles (€) <span aria-hidden="true">*</span>
          </label>
          <input
            id="ressourcesMensuelles"
            type="number"
            step="0.01"
            min="0"
            required
            aria-required="true"
            aria-invalid={erreurPour('ressourcesMensuelles') ? true : undefined}
            {...(erreurPour('ressourcesMensuelles')
              ? { 'aria-describedby': idErreur('ressourcesMensuelles') }
              : {})}
            value={ressourcesMensuelles}
            onChange={(e) => {
              setRessourcesMensuelles(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('ressourcesMensuelles') && (
            <span
              id={idErreur('ressourcesMensuelles')}
              className="debit"
              role="alert"
            >
              {erreurPour('ressourcesMensuelles')}
            </span>
          )}

          <label htmlFor="rfr">
            Revenu fiscal de référence — <Abbr sigle="RFR" /> (€){' '}
            <span aria-hidden="true">*</span>
          </label>
          <input
            id="rfr"
            type="number"
            step="0.01"
            min="0"
            required
            aria-required="true"
            aria-invalid={erreurPour('rfr') ? true : undefined}
            {...(erreurPour('rfr')
              ? { 'aria-describedby': idErreur('rfr') }
              : {})}
            value={rfr}
            onChange={(e) => {
              setRfr(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('rfr') && (
            <span id={idErreur('rfr')} className="debit" role="alert">
              {erreurPour('rfr')}
            </span>
          )}

          <label htmlFor="nbEnfantsACharge">
            Nombre d&apos;enfants à charge <span aria-hidden="true">*</span>
          </label>
          <input
            id="nbEnfantsACharge"
            type="number"
            min="1"
            step="1"
            required
            aria-required="true"
            aria-invalid={erreurPour('nbEnfantsACharge') ? true : undefined}
            {...(erreurPour('nbEnfantsACharge')
              ? { 'aria-describedby': idErreur('nbEnfantsACharge') }
              : {})}
            value={nbEnfantsACharge}
            onChange={(e) => {
              setNbEnfantsACharge(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('nbEnfantsACharge') && (
            <span
              id={idErreur('nbEnfantsACharge')}
              className="debit"
              role="alert"
            >
              {erreurPour('nbEnfantsACharge')}
            </span>
          )}

          <label htmlFor="nbParts">
            Nombre de parts fiscales <span aria-hidden="true">*</span>
          </label>
          <input
            id="nbParts"
            type="number"
            step="0.5"
            min="0.5"
            required
            aria-required="true"
            aria-invalid={erreurPour('nbParts') ? true : undefined}
            {...(erreurPour('nbParts')
              ? { 'aria-describedby': idErreur('nbParts') }
              : {})}
            value={nbParts}
            onChange={(e) => {
              setNbParts(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('nbParts') && (
            <span id={idErreur('nbParts')} className="debit" role="alert">
              {erreurPour('nbParts')}
            </span>
          )}
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Enfants
          </legend>

          {enfants.map((enfant) => (
            <div
              key={enfant.id}
              className="carte"
              style={{
                marginBottom: '0.5rem',
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'flex-end',
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

        <div style={{ marginTop: '1.5rem' }}>
          <button type="submit" className="btn" disabled={chargement}>
            {chargement ? 'Création en cours…' : 'Créer le foyer'}
          </button>
        </div>
      </form>
    </div>
  );
}
