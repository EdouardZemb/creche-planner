import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useTitrePage } from '../hooks/useTitrePage';
import { useAsync } from '../hooks/useAsync';
import {
  extraireErreurs,
  focaliserSection,
  messageErreur,
  type ErreurChamp,
} from '../utils/erreurs';
import type {
  DossierFoyerVue,
  EnfantVue,
  FoyerVue,
  ParentVue,
} from '../types/bff';
import {
  FoyerScalairesForm,
  type ChampScalaireFoyer,
  type ValeursScalairesFoyer,
} from './FoyerScalairesForm';
import { ParentsSection } from './ParentsSection';
import { EnfantsSection } from './EnfantsSection';
import { useContrats } from './useContrats';

/**
 * Valeurs de saisie (chaînes) dérivées d'un foyer chargé : on pré-remplit avec
 * les montants en **euros** exposés par la vue (le BFF stocke en centimes), et
 * `nb enfants à charge` / `nb parts` tels quels.
 */
function valeursDepuisFoyer(foyer: FoyerVue): ValeursScalairesFoyer {
  return {
    ressourcesMensuelles: String(foyer.ressourcesMensuellesEuros),
    rfr: String(foyer.rfrEuros),
    nbEnfantsACharge: String(foyer.nbEnfantsACharge),
    nbParts: String(foyer.nbParts),
  };
}

/**
 * Écran d'édition d'un foyer (« cycle de vie du foyer »), pilotable par le
 * **parent** propriétaire (BFF `@FoyerScope`). Monté sous `GardeFoyer`, qui a déjà
 * traité l'absence / panne du foyer ; on relit ici le dossier pour pré-remplir.
 * Trois blocs : les **scalaires** (P2, `PUT /v1/foyers/:id`), les **parents** (P3,
 * CRUD unitaire) et les **enfants** (P4, CRUD unitaire : ajout / édition /
 * suppression).
 */
export function FoyerModifierPage() {
  useTitrePage('Modifier le foyer');
  const { foyerId } = useParams<{ foyerId: string }>();
  const id = foyerId ?? '';
  const { data, loading, error } = useAsync<DossierFoyerVue>(
    (signal) => api.lireFoyer(id, { signal }),
    [id],
  );

  if (loading) {
    return <p className="muted">Chargement du foyer…</p>;
  }
  // `GardeFoyer` traite déjà 404 / 5xx / session expirée en amont (l'`<Outlet/>`
  // n'est rendu qu'après un chargement réussi). Ce repli ne couvre donc que
  // l'échec résiduel de cette relecture : on annonce le message plutôt que de
  // dupliquer les écrans de récupération.
  if (error || !data) {
    return (
      <p className="debit" role="alert">
        {error ?? 'Foyer indisponible.'}
      </p>
    );
  }
  // `key` lie l'état initial du formulaire au foyer chargé : si l'id change, le
  // sous-composant est remonté avec les bonnes valeurs de départ.
  return (
    <FormulaireEdition
      key={data.foyer.id}
      foyerId={id}
      foyer={data.foyer}
      parents={data.parents}
      enfants={data.enfants}
    />
  );
}

function FormulaireEdition({
  foyerId,
  foyer,
  parents,
  enfants,
}: {
  readonly foyerId: string;
  readonly foyer: FoyerVue;
  readonly parents: readonly ParentVue[];
  readonly enfants: readonly EnfantVue[];
}) {
  const navigate = useNavigate();
  const idBase = useId();
  // Contrats du foyer (cache par foyer, coût quasi nul) : permet à la suppression
  // d'un enfant d'avertir du nombre de contrats qui lui restent liés. Une lecture
  // en cours/échouée laisse `contrats` vide ⇒ modale générique (ne bloque pas).
  const { contrats } = useContrats(foyerId);

  const [scalaires, setScalaires] = useState<ValeursScalairesFoyer>(() =>
    valeursDepuisFoyer(foyer),
  );
  const [chargement, setChargement] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);
  const refErreurGlobale = useRef<HTMLParagraphElement>(null);

  // À l'apparition d'une erreur globale (BFF sans détail par champ), on porte le
  // focus sur l'alerte plutôt que de rester muet (parité avec la création).
  useEffect(() => {
    if (erreurGlobale) {
      focaliserSection(refErreurGlobale.current);
    }
  }, [erreurGlobale]);

  function setScalaire(champ: ChampScalaireFoyer, valeur: string) {
    setScalaires((prev) => ({ ...prev, [champ]: valeur }));
  }

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }

  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  async function soumettre(ev: FormEvent) {
    ev.preventDefault();
    setChargement(true);
    setErreurGlobale(null);
    setErreursChamps([]);

    try {
      await api.modifierFoyer(foyerId, {
        ressourcesMensuelles: parseFloat(scalaires.ressourcesMensuelles),
        rfr: parseFloat(scalaires.rfr),
        nbEnfantsACharge: parseInt(scalaires.nbEnfantsACharge, 10),
        nbParts: parseFloat(scalaires.nbParts),
      });
      // react-router v7 : `navigate` renvoie une Promise ; navigation
      // fire-and-forget (on n'attend pas la transition), d'où le `void`.
      void navigate(`/foyers/${foyerId}/planning`);
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
      <h1 style={{ marginTop: 0 }}>Modifier le foyer</h1>

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

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
          <button type="submit" className="btn" disabled={chargement}>
            {chargement ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </button>
          <button
            type="button"
            className="btn secondaire"
            onClick={() => {
              void navigate(`/foyers/${foyerId}/planning`);
            }}
          >
            Annuler
          </button>
        </div>
      </form>

      {/* Parents et enfants se gèrent hors du formulaire de scalaires : chaque
          écriture est unitaire et persiste immédiatement (pas de soumission
          groupée), et n'est donc pas emportée par « Enregistrer les
          modifications » (qui ne concerne que les scalaires). */}
      <ParentsSection foyerId={foyerId} parentsInitiaux={parents} />
      <EnfantsSection
        foyerId={foyerId}
        enfantsInitiaux={enfants}
        contrats={contrats}
      />
    </div>
  );
}
