import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFoyer } from '../hooks/useFoyer';
import { useContrats } from './useContrats';
import { useEtablissements } from '../etablissements/useEtablissements';
import { ContratForm } from './ContratForm';
import { api, ApiError } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import { libelleMode } from '../utils/libelles';
import { useTitrePage } from '../hooks/useTitrePage';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { EtatVide } from '../ui/EtatVide';
import { ChargementPage } from '../ui/ChargementPage';
import type { ContratLocal } from '../types/bff';

function formaterDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

interface LigneContratProps {
  contrat: ContratLocal;
  onModifier: () => void;
  onSupprimer: () => void;
  suppressionEnCours: boolean;
}

function LigneContrat({
  contrat,
  onModifier,
  onSupprimer,
  suppressionEnCours,
}: LigneContratProps) {
  return (
    <div className="carte carte-contrat">
      <div className="carte-contrat-infos">
        <div>
          <strong>{contrat.enfant}</strong>
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            {libelleMode(contrat.mode)}
          </span>
        </div>
        <span className="muted carte-contrat-periode">
          {contrat.valideAu
            ? `du ${formaterDate(contrat.valideDu)} au ${formaterDate(contrat.valideAu)}`
            : `depuis le ${formaterDate(contrat.valideDu)} — sans date de fin`}
        </span>
      </div>
      <div className="carte-contrat-actions">
        <button
          type="button"
          className="btn secondaire"
          onClick={onModifier}
          aria-label={`Modifier le contrat de ${contrat.enfant}`}
        >
          Modifier
        </button>
        <button
          type="button"
          className="btn danger contour"
          onClick={onSupprimer}
          disabled={suppressionEnCours}
          aria-label={`Supprimer le contrat de ${contrat.enfant}`}
        >
          {suppressionEnCours ? 'Suppression…' : 'Supprimer'}
        </button>
      </div>
    </div>
  );
}

export function ContratsPage() {
  useTitrePage('Contrats');
  const { foyerId } = useParams<{ foyerId: string }>();
  const id = foyerId ?? '';
  const { data, loading, error } = useFoyer(id);
  const {
    contrats,
    chargement: chargementContrats,
    erreur: erreurContrats,
    recharger,
  } = useContrats(id);
  // Établissements du foyer : alimentent le sélecteur du formulaire de contrat
  // (rattachement à un existant ou création à la volée).
  const { data: etablissements } = useEtablissements(id);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [contratEdite, setContratEdite] = useState<ContratLocal | null>(null);
  const [suppressionId, setSuppressionId] = useState<string | null>(null);
  // UT-03 : contrat dont la suppression est en attente de confirmation (modale).
  const [contratASupprimer, setContratASupprimer] =
    useState<ContratLocal | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [messageSucces, setMessageSucces] = useState<string | null>(null);

  function ouvrirCreation() {
    setContratEdite(null);
    setErreurAction(null);
    setMessageSucces(null);
    setFormulaireOuvert(true);
  }

  function ouvrirEdition(contrat: ContratLocal) {
    setContratEdite(contrat);
    setErreurAction(null);
    setMessageSucces(null);
    setFormulaireOuvert(true);
  }

  function fermerFormulaire() {
    setFormulaireOuvert(false);
    setContratEdite(null);
  }

  function onSoumis(contrat: ContratLocal) {
    // La création/édition a déjà été persistée via l'API (ContratForm) ; on
    // recharge la liste depuis le serveur pour refléter l'état réel.
    setMessageSucces(
      contratEdite
        ? `Contrat de ${contrat.enfant} modifié.`
        : `Contrat de ${contrat.enfant} créé.`,
    );
    recharger();
    fermerFormulaire();
  }

  // UT-03 : ouvre la modale de confirmation (plus de window.confirm natif).
  function demanderSuppression(contrat: ContratLocal) {
    setContratASupprimer(contrat);
  }

  function annulerSuppression() {
    setContratASupprimer(null);
  }

  async function confirmerSuppression() {
    const contrat = contratASupprimer;
    if (!contrat) return;
    setContratASupprimer(null);
    setSuppressionId(contrat.id);
    setErreurAction(null);
    setMessageSucces(null);
    try {
      await api.supprimerContrat(contrat.id);
      recharger();
      setMessageSucces(`Contrat de ${contrat.enfant} supprimé.`);
    } catch (err) {
      // 404 (contrat déjà absent côté serveur) : on recharge quand même la liste.
      if (err instanceof ApiError && err.status === 404) {
        recharger();
        setMessageSucces(`Contrat de ${contrat.enfant} supprimé.`);
      } else {
        setErreurAction(messageErreur(err));
      }
    } finally {
      setSuppressionId(null);
    }
  }

  return (
    <div>
      {/* Les liens Planning/Coûts dupliquaient la navigation globale (barre
          d'onglets mobile + en-tête desktop) : l'en-tête ne garde que le titre. */}
      <h1 style={{ marginTop: 0, marginBottom: '1rem' }}>Contrats</h1>

      {loading && <ChargementPage message="Chargement de votre famille…" />}
      {error && (
        <p className="debit" role="alert">
          Impossible de charger les données de la famille : {error}
        </p>
      )}

      {data && (
        <div className="carte" style={{ marginBottom: '1.5rem' }}>
          <strong>Famille</strong>{' '}
          <span className="muted">
            {data.enfants.length} enfant{data.enfants.length !== 1 ? 's' : ''} —{' '}
            tranche de revenus {data.foyer.tranche}
          </span>
        </div>
      )}

      {erreurAction && (
        <p className="debit" role="alert">
          {erreurAction}
        </p>
      )}

      <div role="status" aria-live="polite">
        {messageSucces && <p className="credit">{messageSucces}</p>}
      </div>

      <section>
        {chargementContrats ? (
          <p className="muted">Chargement des contrats…</p>
        ) : erreurContrats ? (
          <p className="debit" role="alert">
            Impossible de charger les contrats : {erreurContrats}
          </p>
        ) : contrats.length === 0 ? (
          formulaireOuvert ? null : (
            <EtatVide
              titre="Aucun contrat pour l’instant"
              description="Le contrat décrit la garde de votre enfant (crèche, cantine, périscolaire ou centre de loisirs) : c’est lui qui alimente le planning et le calcul des coûts."
              actions={[
                { libelle: '+ Nouveau contrat', onClick: ouvrirCreation },
              ]}
            />
          )
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>Vos contrats</h2>
            {contrats.map((c) => (
              <LigneContrat
                key={c.id}
                contrat={c}
                onModifier={() => {
                  ouvrirEdition(c);
                }}
                onSupprimer={() => {
                  demanderSuppression(c);
                }}
                suppressionEnCours={suppressionId === c.id}
              />
            ))}
          </>
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        {!formulaireOuvert ? (
          // L'état vide porte déjà le CTA : pas de second bouton en doublon.
          contrats.length === 0 &&
          !chargementContrats &&
          !erreurContrats ? null : (
            <button
              type="button"
              className="btn"
              onClick={ouvrirCreation}
              disabled={!data}
            >
              + Nouveau contrat
            </button>
          )
        ) : (
          <div className="carte">
            <h2 style={{ marginTop: 0 }}>
              {contratEdite ? 'Modifier le contrat' : 'Nouveau contrat'}
            </h2>
            {data ? (
              <ContratForm
                foyerId={id}
                enfants={data.enfants}
                etablissements={etablissements ?? []}
                {...(contratEdite ? { contrat: contratEdite } : {})}
                onCree={onSoumis}
                onAnnuler={fermerFormulaire}
              />
            ) : (
              <p className="muted">Chargement des enfants…</p>
            )}
          </div>
        )}
      </section>

      <ModaleConfirmation
        ouvert={contratASupprimer !== null}
        titre="Supprimer le contrat"
        message={
          contratASupprimer
            ? `Le contrat de ${contratASupprimer.enfant} sera définitivement supprimé. Cette action est irréversible.`
            : ''
        }
        libelleConfirmer="Supprimer le contrat"
        destructif
        onConfirmer={() => void confirmerSuppression()}
        onAnnuler={annulerSuppression}
      />
    </div>
  );
}
