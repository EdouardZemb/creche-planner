import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { StatutSauvegarde, type EtatSauvegarde } from '../ui/StatutSauvegarde';

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
  const idBase = useId();
  // Contrats du foyer (cache par foyer, coût quasi nul) : permet à la suppression
  // d'un enfant d'avertir du nombre de contrats qui lui restent liés. Une lecture
  // en cours/échouée laisse `contrats` vide ⇒ modale générique (ne bloque pas).
  const { contrats } = useContrats(foyerId);

  // Dernières valeurs **enregistrées** : au montage, celles du foyer chargé ;
  // après un PUT réussi, la vue renvoyée par le serveur. « Rétablir » repart de
  // là (jamais des valeurs de montage) pour ne pas défaire un enregistrement.
  const [foyerEnregistre, setFoyerEnregistre] = useState<FoyerVue>(foyer);
  const [scalaires, setScalaires] = useState<ValeursScalairesFoyer>(() =>
    valeursDepuisFoyer(foyer),
  );
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
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
    setEtatSauvegarde('en-cours');
    setErreurGlobale(null);
    setErreursChamps([]);

    try {
      const vue = await api.modifierFoyer(foyerId, {
        ressourcesMensuelles: parseFloat(scalaires.ressourcesMensuelles),
        rfr: parseFloat(scalaires.rfr),
        nbEnfantsACharge: parseInt(scalaires.nbEnfantsACharge, 10),
        nbParts: parseFloat(scalaires.nbParts),
      });
      // Le PUT renvoie la vue à jour : elle devient la base de « Rétablir » et
      // les valeurs affichées (montants normalisés côté serveur). On RESTE sur
      // la page ; le statut d'enregistrement fait le retour visuel.
      setFoyerEnregistre(vue);
      setScalaires(valeursDepuisFoyer(vue));
      setEnregistreA(
        new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
      setEtatSauvegarde('enregistre');
    } catch (err) {
      setEtatSauvegarde('erreur');
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
    }
  }

  /**
   * « Rétablir » : restaure les **dernières valeurs enregistrées** (celles du
   * dernier PUT réussi, ou du foyer chargé si aucun PUT), efface les erreurs et
   * reste sur la page. On ne touche pas à `etatSauvegarde` : un
   * « Enregistré à HH:MM » déjà affiché reste vrai (on ne défait pas un
   * enregistrement réussi).
   */
  function retablir() {
    setScalaires(valeursDepuisFoyer(foyerEnregistre));
    setErreurGlobale(null);
    setErreursChamps([]);
  }

  return (
    <div className="carte" style={{ maxWidth: 600 }}>
      <h1 style={{ marginTop: 0 }}>Modifier le foyer</h1>

      {erreurGlobale && (
        <p className="debit" role="alert" tabIndex={-1} ref={refErreurGlobale}>
          {erreurGlobale}
        </p>
      )}

      {/* Ordre calqué sur la création : enfants, parents, puis ressources.
          Parents et enfants se gèrent hors du formulaire de scalaires : chaque
          écriture est unitaire et persiste immédiatement (pas de soumission
          groupée), et n'est donc pas emportée par « Enregistrer les
          modifications » (qui ne concerne que les scalaires). */}
      <EnfantsSection
        foyerId={foyerId}
        enfantsInitiaux={enfants}
        contrats={contrats}
      />
      <ParentsSection foyerId={foyerId} parentsInitiaux={parents} />

      <form onSubmit={(ev) => void soumettre(ev)}>
        <FoyerScalairesForm
          valeurs={scalaires}
          onChange={setScalaire}
          erreurPour={erreurPour}
          idErreur={idErreur}
        />

        <div
          style={{
            marginTop: '1.5rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <button
            type="submit"
            className="btn"
            disabled={etatSauvegarde === 'en-cours'}
          >
            {etatSauvegarde === 'en-cours'
              ? 'Enregistrement…'
              : 'Enregistrer les modifications'}
          </button>
          <button
            type="button"
            className="btn secondaire"
            onClick={retablir}
            disabled={etatSauvegarde === 'en-cours'}
          >
            Rétablir
          </button>
          <StatutSauvegarde etat={etatSauvegarde} enregistreA={enregistreA} />
        </div>
      </form>
    </div>
  );
}
