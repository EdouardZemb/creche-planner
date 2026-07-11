import { useId, useState } from 'react';
import { api, ApiError } from '../api/client';
import { extraireErreurs } from '../utils/erreurs';
import { messageErreurParent, retraduireErreurParent } from './parentErreurs';
import { useMoi } from '../session/MoiContext';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { StatutSauvegarde, type EtatSauvegarde } from '../ui/StatutSauvegarde';
import type { ErreurChamp } from '../utils/erreurs';
import type { ParentVue } from '../types/bff';

/** Heure locale « 21:43 » posée dans le statut d'un enregistrement réussi. */
function heureCourante(): string {
  return new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Gestion des **parents** d'un foyer dans l'écran d'édition (P3 « cycle de vie du
 * foyer ») : liste des parents actifs + ajout / édition / retrait, chacun via une
 * écriture **unitaire** au BFF (`POST`/`PUT`/`DELETE /v1/foyers/:id/parents[...]`,
 * gardées `@FoyerScope` → pilotables par le parent du foyer). Les lignes
 * dynamiques reprennent la trame de `FoyerFormPage`, mais ici chaque ligne
 * persiste indépendamment (pas de soumission groupée).
 */
export function ParentsSection({
  foyerId,
  parentsInitiaux,
}: {
  readonly foyerId: string;
  readonly parentsInitiaux: readonly ParentVue[];
}) {
  const [parents, setParents] = useState<ParentVue[]>(() => [
    ...parentsInitiaux,
  ]);

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '1.5rem 0 0' }}>
      <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        Parents
      </legend>
      <p className="muted" style={{ marginTop: 0 }}>
        Destinataires des récapitulatifs hebdomadaires. Au moins un parent est
        recommandé.
      </p>

      {parents.length === 0 && (
        <p className="muted">Aucun parent rattaché pour l’instant.</p>
      )}

      {parents.map((parent) => (
        <LigneParentExistant
          key={parent.id}
          foyerId={foyerId}
          parent={parent}
          onModifie={(maj) => {
            setParents((prev) => prev.map((p) => (p.id === maj.id ? maj : p)));
          }}
          onRetire={(id) => {
            setParents((prev) => prev.filter((p) => p.id !== id));
          }}
        />
      ))}

      <FormNouveauParent
        foyerId={foyerId}
        onAjoute={(parent) => {
          setParents((prev) => [...prev, parent]);
        }}
      />
    </fieldset>
  );
}

/** Compare deux e-mails de façon insensible à la casse et aux espaces. */
function memeEmail(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Une ligne de parent **existant**, éditable sur place (e-mail, identité douce,
 * statut principal) avec persistance unitaire, et retirable (soft-delete amont).
 */
function LigneParentExistant({
  foyerId,
  parent,
  onModifie,
  onRetire,
}: {
  readonly foyerId: string;
  readonly parent: ParentVue;
  readonly onModifie: (parent: ParentVue) => void;
  readonly onRetire: (id: string) => void;
}) {
  const idBase = useId();
  const moi = useMoi();
  const [email, setEmail] = useState(parent.email);
  const [prenom, setPrenom] = useState(parent.prenom ?? '');
  const [nom, setNom] = useState(parent.nom ?? '');
  const [principal, setPrincipal] = useState(parent.principal);
  const [occupe, setOccupe] = useState(false);
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);
  // Confirmation avant un geste à conséquence : retrait de la ligne, ou
  // remplacement de sa propre adresse (perte d'accès). `null` = aucune modale.
  const [confirmation, setConfirmation] = useState<'retirer' | 'email' | null>(
    null,
  );

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  function gererErreur(err: unknown) {
    setEtatSauvegarde('erreur');
    if (err instanceof ApiError) {
      // Écriture unitaire : les erreurs de champ ne sont pas indexées
      // (`email`/`prenom`/`nom`). On passe quand même par `retraduireErreurParent`
      // (no-op sur un champ non indexé) pour partager la convention avec la
      // création groupée de `FoyerFormPage`.
      const erreurs = extraireErreurs(err.corps).map((e) =>
        retraduireErreurParent(e, [parent.id]),
      );
      if (erreurs.length > 0) {
        setErreursChamps(erreurs);
        return;
      }
    }
    setErreurGlobale(messageErreurParent(err));
  }

  async function enregistrer() {
    setOccupe(true);
    setErreurGlobale(null);
    setErreursChamps([]);
    try {
      const maj = await api.modifierParent(foyerId, parent.id, {
        email: email.trim(),
        prenom: prenom.trim() === '' ? null : prenom.trim(),
        nom: nom.trim() === '' ? null : nom.trim(),
        principal,
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
      await api.retirerParent(foyerId, parent.id);
      onRetire(parent.id);
    } catch (err) {
      setEtatSauvegarde('erreur');
      setErreurGlobale(messageErreurParent(err));
    } finally {
      setOccupe(false);
    }
  }

  // Statut affiché près des boutons : « en-cours » tant qu'une écriture est en
  // vol (`occupe`), sinon le dernier état atteint (persiste après succès/échec).
  const etatAffiche: EtatSauvegarde = occupe ? 'en-cours' : etatSauvegarde;

  const nomComplet = `${prenom.trim()} ${nom.trim()}`.trim();
  const designation = nomComplet || email.trim();
  // La ligne EST mon propre accès si son e-mail d'origine = mon identité (hérité :
  // `moi.email === null` ⇒ jamais, comportement assumé).
  const estMonAcces = memeEmail(parent.email, moi.email);
  // Le PUT change l'adresse à laquelle mon accès est lié.
  const changeMonEmail = estMonAcces && !memeEmail(email, parent.email);

  /**
   * Enregistre, mais **confirme d'abord** si l'on remplace sa propre adresse
   * (l'accès y est lié — le PUT le romprait). Sinon persiste directement.
   */
  function demanderEnregistrer() {
    if (changeMonEmail) {
      setConfirmation('email');
      return;
    }
    void enregistrer();
  }

  return (
    <div className="carte parent-ligne" style={{ marginBottom: '0.5rem' }}>
      {erreurGlobale && (
        <p className="debit" role="alert">
          {erreurGlobale}
        </p>
      )}

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

      <div className="champs-duo" style={{ marginTop: 'var(--esp-2)' }}>
        <div>
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
        <div>
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

      <label className="case-cochable">
        <input
          type="checkbox"
          checked={principal}
          onChange={(e) => {
            setPrincipal(e.target.checked);
          }}
        />
        Contact principal (reçoit les e-mails de la crèche en premier)
      </label>

      <div className="actions-ligne">
        <button
          type="button"
          className="btn secondaire"
          disabled={occupe}
          onClick={demanderEnregistrer}
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          className="btn secondaire"
          disabled={occupe}
          onClick={() => {
            setConfirmation('retirer');
          }}
          aria-label={
            designation
              ? `Retirer le parent ${designation}`
              : 'Retirer ce parent'
          }
        >
          Retirer
        </button>
        <StatutSauvegarde etat={etatAffiche} enregistreA={enregistreA} />
      </div>

      <ModaleConfirmation
        ouvert={confirmation === 'retirer'}
        titre={designation ? `Retirer ${designation}` : 'Retirer ce parent'}
        message={
          estMonAcces
            ? 'C’est votre propre accès : après ce retrait, vous ne pourrez plus consulter ni modifier cette famille.'
            : `${designation || 'Ce parent'} ne recevra plus les récapitulatifs et n’aura plus accès.`
        }
        libelleConfirmer="Retirer"
        destructif
        onConfirmer={() => {
          setConfirmation(null);
          void retirer();
        }}
        onAnnuler={() => {
          setConfirmation(null);
        }}
      />

      <ModaleConfirmation
        ouvert={confirmation === 'email'}
        titre="Modifier votre adresse e-mail"
        message={`Votre accès est lié à l’adresse ${parent.email}. Si vous la remplacez, vous perdrez l’accès avec votre connexion actuelle.`}
        libelleConfirmer="Modifier quand même"
        destructif
        onConfirmer={() => {
          setConfirmation(null);
          void enregistrer();
        }}
        onAnnuler={() => {
          setConfirmation(null);
        }}
      />
    </div>
  );
}

/** Formulaire de rattachement d'un **nouveau** parent (ajout unitaire). */
function FormNouveauParent({
  foyerId,
  onAjoute,
}: {
  readonly foyerId: string;
  readonly onAjoute: (parent: ParentVue) => void;
}) {
  const idBase = useId();
  const [email, setEmail] = useState('');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [etatSauvegarde, setEtatSauvegarde] = useState<EtatSauvegarde>('idle');
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreurChamp[]>([]);

  function erreurPour(champ: string): string | undefined {
    return erreursChamps.find((e) => e.champ === champ)?.message;
  }
  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }

  async function ajouter() {
    setOccupe(true);
    setErreurGlobale(null);
    setErreursChamps([]);
    try {
      const cree = await api.ajouterParent(foyerId, {
        email: email.trim(),
        ...(prenom.trim() ? { prenom: prenom.trim() } : {}),
        ...(nom.trim() ? { nom: nom.trim() } : {}),
      });
      onAjoute(cree);
      setEmail('');
      setPrenom('');
      setNom('');
      setEnregistreA(heureCourante());
      setEtatSauvegarde('enregistre');
    } catch (err) {
      setEtatSauvegarde('erreur');
      if (err instanceof ApiError) {
        const erreurs = extraireErreurs(err.corps).map((e) =>
          retraduireErreurParent(e, ['nouveau']),
        );
        if (erreurs.length > 0) {
          setErreursChamps(erreurs);
          return;
        }
      }
      setErreurGlobale(messageErreurParent(err));
    } finally {
      setOccupe(false);
    }
  }

  const etatAffiche: EtatSauvegarde = occupe ? 'en-cours' : etatSauvegarde;

  return (
    <div
      className="carte parent-ligne"
      style={{ marginBottom: '0.5rem', marginTop: '0.5rem' }}
    >
      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Ajouter un parent</p>

      {erreurGlobale && (
        <p className="debit" role="alert">
          {erreurGlobale}
        </p>
      )}

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

      <div className="champs-duo" style={{ marginTop: 'var(--esp-2)' }}>
        <div>
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
        <div>
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

      <div className="actions-ligne">
        <button
          type="button"
          className="btn secondaire"
          disabled={occupe}
          onClick={() => void ajouter()}
        >
          {occupe ? 'Ajout en cours…' : '+ Ajouter ce parent'}
        </button>
        <StatutSauvegarde etat={etatAffiche} enregistreA={enregistreA} />
      </div>
    </div>
  );
}
