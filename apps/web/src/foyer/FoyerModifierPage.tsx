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
import { HistoriqueRessources } from './HistoriqueRessources';
import { useContrats } from './useContrats';
import { StatutSauvegarde, type EtatSauvegarde } from '../ui/StatutSauvegarde';
import { ChargementPage } from '../ui/ChargementPage';
import { Bouton } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';

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
  useTitrePage('Ma famille');
  const { foyerId } = useParams<{ foyerId: string }>();
  const id = foyerId ?? '';
  const { data, loading, error } = useAsync<DossierFoyerVue>(
    (signal) => api.lireFoyer(id, { signal }),
    [id],
  );

  if (loading) {
    return <ChargementPage message="Chargement de votre famille…" />;
  }
  // `GardeFoyer` traite déjà 404 / 5xx / session expirée en amont (l'`<Outlet/>`
  // n'est rendu qu'après un chargement réussi). Ce repli ne couvre donc que
  // l'échec résiduel de cette relecture : on annonce le message plutôt que de
  // dupliquer les écrans de récupération.
  if (error || !data) {
    return (
      <ChampErreur balise="p">{error ?? 'Famille indisponible.'}</ChampErreur>
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
  // Date d'effet des ressources (SFD 30, DV-03) : défaut aujourd'hui. Une saisie
  // au futur laisse les mois d'avant inchangés ; réutiliser une date existante
  // corrige la version. Compteur pour forcer le rechargement de l'historique.
  const [dateEffet, setDateEffet] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [rechargesHisto, setRechargesHisto] = useState(0);
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
        dateEffet,
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
      // Rafraîchit l'historique (une version vient d'être créée/corrigée).
      setRechargesHisto((n) => n + 1);
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
    <div className="carte page-etroite">
      <h1 className="mt-0">Ma famille</h1>

      <ChampErreur balise="p" focalisable ref={refErreurGlobale}>
        {erreurGlobale}
      </ChampErreur>

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

        {/* Date d'effet (SFD 30) : à partir de quand ces ressources s'appliquent.
            Défaut aujourd'hui ; une date au futur préserve les mois passés. */}
        <label htmlFor={`${idBase}-dateEffet`} className="mt-3">
          À partir du
        </label>
        <input
          id={`${idBase}-dateEffet`}
          type="date"
          value={dateEffet}
          onChange={(e) => {
            setDateEffet(e.target.value);
          }}
          style={{ width: '100%' }}
        />
        <p className="muted mt-1">
          Les mois d’avant cette date gardent leurs montants ; ceux d’après sont
          recalculés.
        </p>

        <div className="actions-ligne mt-5">
          <Bouton type="submit" disabled={etatSauvegarde === 'en-cours'}>
            {etatSauvegarde === 'en-cours'
              ? 'Enregistrement…'
              : 'Enregistrer les modifications'}
          </Bouton>
          <Bouton
            variante="secondaire"
            onClick={retablir}
            disabled={etatSauvegarde === 'en-cours'}
          >
            Rétablir
          </Bouton>
          <StatutSauvegarde etat={etatSauvegarde} enregistreA={enregistreA} />
        </div>
      </form>

      <HistoriqueRessources key={rechargesHisto} foyerId={foyerId} />
    </div>
  );
}
