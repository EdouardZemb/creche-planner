import { useId, useState } from 'react';
import { api, ApiError } from '../api/client';
import { extraireErreurs, messageErreur } from '../utils/erreurs';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { StatutSauvegarde, type EtatSauvegarde } from '../ui/StatutSauvegarde';
import type { ErreurChamp } from '../utils/erreurs';
import type { ContratVue, EnfantVue } from '../types/bff';

/** Heure locale « 21:43 » posée dans le statut d'un enregistrement réussi. */
function heureCourante(): string {
  return new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Gestion des **enfants** d'un foyer dans l'écran d'édition (« cycle de vie du
 * foyer ») : liste des enfants rattachés avec **ajout**, **édition** et
 * **suppression** (hard delete), chacun via une écriture **unitaire** au BFF
 * (`POST`/`PUT`/`DELETE /v1/foyers/:id/enfants[...]`, gardées `@FoyerScope` →
 * pilotables par le parent du foyer).
 *
 * ⚠ Lien par `enfantId` (plan §2.5) : les contrats de garde **référencent**
 * l'enfant par son identifiant ; un **renommage** se propage à leur prénom
 * dénormalisé (projection `foyer.EnfantModifie`), mais une **suppression**
 * d'enfant ne supprime PAS ses contrats (ils restent affichés avec le prénom).
 * On l'énonce à l'écran, et la suppression avertit du nombre de contrats liés.
 */
export function EnfantsSection({
  foyerId,
  enfantsInitiaux,
  contrats = [],
}: {
  readonly foyerId: string;
  readonly enfantsInitiaux: readonly EnfantVue[];
  /**
   * Contrats du foyer (chargés par `FoyerModifierPage`, cache par foyer) : sert à
   * avertir, avant suppression d'un enfant, du nombre de contrats qui lui restent
   * liés. Défaut `[]` (contrats indisponibles ⇒ variante générique de la modale).
   */
  readonly contrats?: readonly ContratVue[];
}) {
  const [enfants, setEnfants] = useState<EnfantVue[]>(() => [
    ...enfantsInitiaux,
  ]);

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '1.5rem 0 0' }}>
      <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        Enfants
      </legend>
      <p className="muted" style={{ marginTop: 0 }}>
        Renommer un enfant met aussi à jour ses contrats de garde. Supprimer un
        enfant ne supprime pas ses contrats.
      </p>

      {enfants.length === 0 && (
        <p className="muted">Aucun enfant rattaché pour l’instant.</p>
      )}

      {enfants.map((enfant) => (
        <LigneEnfantExistant
          key={enfant.id}
          foyerId={foyerId}
          enfant={enfant}
          nbContrats={contrats.filter((c) => c.enfantId === enfant.id).length}
          onModifie={(maj) => {
            setEnfants((prev) => prev.map((e) => (e.id === maj.id ? maj : e)));
          }}
          onRetire={(id) => {
            setEnfants((prev) => prev.filter((e) => e.id !== id));
          }}
        />
      ))}

      <FormNouvelEnfant
        foyerId={foyerId}
        onAjoute={(enfant) => {
          setEnfants((prev) => [...prev, enfant]);
        }}
      />
    </fieldset>
  );
}

/** Champ d'erreur ↔ message, dérivé d'une liste `[{champ,message}]`. */
function lecteurErreurs(erreursChamps: ErreurChamp[]) {
  return (champ: string): string | undefined =>
    erreursChamps.find((e) => e.champ === champ)?.message;
}

/**
 * Une ligne d'enfant **existant**, éditable sur place (prénom, date de naissance)
 * avec persistance unitaire, et supprimable (hard delete amont).
 */
function LigneEnfantExistant({
  foyerId,
  enfant,
  nbContrats,
  onModifie,
  onRetire,
}: {
  readonly foyerId: string;
  readonly enfant: EnfantVue;
  /** Nombre de contrats de garde encore liés à cet enfant (pour l'avertissement). */
  readonly nbContrats: number;
  readonly onModifie: (enfant: EnfantVue) => void;
  readonly onRetire: (id: string) => void;
}) {
  const idBase = useId();
  const [prenom, setPrenom] = useState(enfant.prenom);
  const [dateNaissance, setDateNaissance] = useState(enfant.dateNaissance);
  const [occupe, setOccupe] = useState(false);
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);
  const [confirmation, setConfirmation] = useState(false);

  const erreurPour = lecteurErreurs(erreursChamps);
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  function gererErreur(err: unknown) {
    setEtatSauvegarde('erreur');
    if (err instanceof ApiError) {
      const erreurs = extraireErreurs(err.corps);
      if (erreurs.length > 0) {
        setErreursChamps(erreurs);
        return;
      }
    }
    setErreurGlobale(messageErreur(err));
  }

  async function enregistrer() {
    setOccupe(true);
    setErreurGlobale(null);
    setErreursChamps([]);
    try {
      const maj = await api.modifierEnfant(foyerId, enfant.id, {
        prenom: prenom.trim(),
        dateNaissance,
      });
      onModifie(maj);
      setEnregistreA(heureCourante());
      setEtatSauvegarde('enregistre');
    } catch (err) {
      gererErreur(err);
    } finally {
      setOccupe(false);
    }
  }

  async function retirer() {
    setOccupe(true);
    setErreurGlobale(null);
    setErreursChamps([]);
    try {
      await api.retirerEnfant(foyerId, enfant.id);
      onRetire(enfant.id);
    } catch (err) {
      setEtatSauvegarde('erreur');
      setErreurGlobale(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  }

  const designation = prenom.trim() || enfant.prenom;
  // Statut affiché près des boutons : « en-cours » pendant une écriture, sinon
  // le dernier état atteint (persiste après succès/échec).
  const etatAffiche: EtatSauvegarde = occupe ? 'en-cours' : etatSauvegarde;

  return (
    <div className="carte enfant-ligne" style={{ marginBottom: '0.5rem' }}>
      {erreurGlobale && (
        <p className="debit" role="alert">
          {erreurGlobale}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor={`${idBase}-prenom`}>
            Prénom <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${idBase}-prenom`}
            type="text"
            aria-required="true"
            aria-invalid={erreurPour('prenom') ? true : undefined}
            {...(erreurPour('prenom')
              ? { 'aria-describedby': idErreur('prenom') }
              : {})}
            value={prenom}
            onChange={(e) => {
              setPrenom(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('prenom') && (
            <span id={idErreur('prenom')} className="debit" role="alert">
              {erreurPour('prenom')}
            </span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor={`${idBase}-naissance`}>
            Date de naissance <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${idBase}-naissance`}
            type="date"
            aria-required="true"
            aria-invalid={erreurPour('dateNaissance') ? true : undefined}
            {...(erreurPour('dateNaissance')
              ? { 'aria-describedby': idErreur('dateNaissance') }
              : {})}
            value={dateNaissance}
            onChange={(e) => {
              setDateNaissance(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('dateNaissance') && (
            <span id={idErreur('dateNaissance')} className="debit" role="alert">
              {erreurPour('dateNaissance')}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          className="btn secondaire"
          disabled={occupe || prenom.trim() === '' || dateNaissance === ''}
          onClick={() => void enregistrer()}
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          className="btn secondaire"
          disabled={occupe}
          onClick={() => {
            setConfirmation(true);
          }}
          aria-label={`Supprimer l’enfant ${designation}`}
        >
          Supprimer
        </button>
        <StatutSauvegarde etat={etatAffiche} enregistreA={enregistreA} />
      </div>

      <ModaleConfirmation
        ouvert={confirmation}
        titre={`Supprimer ${designation}`}
        message={
          nbContrats > 0
            ? `${designation} a ${nbContrats} contrat(s) de garde. Ils ne seront pas supprimés et resteront affichés avec son prénom. Supprimez-les d’abord depuis la page Contrats si nécessaire. Cette suppression est définitive.`
            : `${designation} sera définitivement retiré(e). Cette action est irréversible.`
        }
        libelleConfirmer="Supprimer"
        destructif
        onConfirmer={() => {
          setConfirmation(false);
          void retirer();
        }}
        onAnnuler={() => {
          setConfirmation(false);
        }}
      />
    </div>
  );
}

/** Formulaire de rattachement d'un **nouvel** enfant (ajout unitaire). */
function FormNouvelEnfant({
  foyerId,
  onAjoute,
}: {
  readonly foyerId: string;
  readonly onAjoute: (enfant: EnfantVue) => void;
}) {
  const idBase = useId();
  const [prenom, setPrenom] = useState('');
  const [dateNaissance, setDateNaissance] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);

  const erreurPour = lecteurErreurs(erreursChamps);
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  async function ajouter() {
    setOccupe(true);
    setErreurGlobale(null);
    setErreursChamps([]);
    try {
      const cree = await api.ajouterEnfant(foyerId, {
        prenom: prenom.trim(),
        dateNaissance,
      });
      onAjoute(cree);
      setPrenom('');
      setDateNaissance('');
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
      }
      setErreurGlobale(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  }

  const etatAffiche: EtatSauvegarde = occupe ? 'en-cours' : etatSauvegarde;

  return (
    <div className="carte enfant-ligne" style={{ marginBottom: '0.5rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Ajouter un enfant</p>

      {erreurGlobale && (
        <p className="debit" role="alert">
          {erreurGlobale}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor={`${idBase}-prenom`}>
            Prénom <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${idBase}-prenom`}
            type="text"
            aria-required="true"
            aria-invalid={erreurPour('prenom') ? true : undefined}
            {...(erreurPour('prenom')
              ? { 'aria-describedby': idErreur('prenom') }
              : {})}
            value={prenom}
            onChange={(e) => {
              setPrenom(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('prenom') && (
            <span id={idErreur('prenom')} className="debit" role="alert">
              {erreurPour('prenom')}
            </span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor={`${idBase}-naissance`}>
            Date de naissance <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${idBase}-naissance`}
            type="date"
            aria-required="true"
            aria-invalid={erreurPour('dateNaissance') ? true : undefined}
            {...(erreurPour('dateNaissance')
              ? { 'aria-describedby': idErreur('dateNaissance') }
              : {})}
            value={dateNaissance}
            onChange={(e) => {
              setDateNaissance(e.target.value);
            }}
            style={{ width: '100%' }}
          />
          {erreurPour('dateNaissance') && (
            <span id={idErreur('dateNaissance')} className="debit" role="alert">
              {erreurPour('dateNaissance')}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          marginTop: '0.5rem',
        }}
      >
        <button
          type="button"
          className="btn secondaire"
          disabled={occupe || prenom.trim() === '' || dateNaissance === ''}
          onClick={() => void ajouter()}
        >
          {occupe ? 'Ajout en cours…' : '+ Ajouter cet enfant'}
        </button>
        <StatutSauvegarde etat={etatAffiche} enregistreA={enregistreA} />
      </div>
    </div>
  );
}
