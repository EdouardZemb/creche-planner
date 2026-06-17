import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useFoyer } from '../hooks/useFoyer';
import { useContrats } from './useContrats';
import { ContratForm } from './ContratForm';
import { api, ApiError } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import { libelleMode } from '../utils/libelles';
import { useTitrePage } from '../hooks/useTitrePage';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
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
    <div
      className="carte"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <div>
        <strong>{contrat.enfant}</strong>
        <span className="muted" style={{ marginLeft: '0.5rem' }}>
          {libelleMode(contrat.mode)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          du {formaterDate(contrat.valideDu)}
          {contrat.valideAu
            ? ` au ${formaterDate(contrat.valideAu)}`
            : ' (ouvert)'}
        </span>
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
          className="btn secondaire"
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Contrats du foyer</h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link to={`/foyers/${id}/planning`} className="btn secondaire">
            Planning
          </Link>
          <Link to={`/foyers/${id}/couts`} className="btn secondaire">
            Coûts annuels
          </Link>
        </div>
      </div>

      {loading && <p className="muted">Chargement du foyer…</p>}
      {error && (
        <p className="debit" role="alert">
          Impossible de charger les données du foyer : {error}
        </p>
      )}

      {data && (
        <div className="carte" style={{ marginBottom: '1.5rem' }}>
          <strong>Foyer</strong>{' '}
          <span className="muted">
            {data.enfants.length} enfant{data.enfants.length !== 1 ? 's' : ''} —{' '}
            tranche {data.foyer.tranche}
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
        <h2 style={{ marginTop: 0 }}>Contrats créés</h2>
        {chargementContrats ? (
          <p className="muted">Chargement des contrats…</p>
        ) : erreurContrats ? (
          <p className="debit" role="alert">
            Impossible de charger les contrats : {erreurContrats}
          </p>
        ) : contrats.length === 0 ? (
          <p className="muted">Aucun contrat pour ce foyer.</p>
        ) : (
          contrats.map((c) => (
            <LigneContrat
              key={c.id}
              contrat={c}
              onModifier={() => ouvrirEdition(c)}
              onSupprimer={() => demanderSuppression(c)}
              suppressionEnCours={suppressionId === c.id}
            />
          ))
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        {!formulaireOuvert ? (
          <button
            type="button"
            className="btn"
            onClick={ouvrirCreation}
            disabled={!data}
          >
            + Nouveau contrat
          </button>
        ) : (
          <div className="carte">
            <h2 style={{ marginTop: 0 }}>
              {contratEdite ? 'Modifier le contrat' : 'Nouveau contrat'}
            </h2>
            {data ? (
              <ContratForm
                foyerId={id}
                enfants={data.enfants}
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
