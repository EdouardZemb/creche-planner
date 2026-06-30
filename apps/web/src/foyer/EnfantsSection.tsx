import { useId, useState } from 'react';
import { api, ApiError } from '../api/client';
import { extraireErreurs, messageErreur } from '../utils/erreurs';
import type { ErreurChamp } from '../utils/erreurs';
import type { EnfantVue } from '../types/bff';

/**
 * Gestion des **enfants** d'un foyer dans l'écran d'édition (P3) : liste des
 * enfants rattachés et **ajout** (`POST /v1/foyers/:id/enfants`, `@FoyerScope`).
 * L'édition et la suppression d'un enfant ne sont **pas** ici : elles dépendent
 * d'un complément backend (nouveaux événements `EnfantModifie`/`EnfantRetire`),
 * livré dans une phase ultérieure.
 */
export function EnfantsSection({
  foyerId,
  enfantsInitiaux,
}: {
  readonly foyerId: string;
  readonly enfantsInitiaux: readonly EnfantVue[];
}) {
  const idBase = useId();
  const [enfants, setEnfants] = useState<EnfantVue[]>(() => [
    ...enfantsInitiaux,
  ]);
  const [prenom, setPrenom] = useState('');
  const [dateNaissance, setDateNaissance] = useState('');
  const [occupe, setOccupe] = useState(false);
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
      const cree = await api.ajouterEnfant(foyerId, {
        prenom: prenom.trim(),
        dateNaissance,
      });
      setEnfants((prev) => [...prev, cree]);
      setPrenom('');
      setDateNaissance('');
    } catch (err) {
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

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '1.5rem 0 0' }}>
      <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        Enfants
      </legend>
      <p className="muted" style={{ marginTop: 0 }}>
        Ajout d’un enfant au foyer. La modification et la suppression d’un
        enfant arriveront prochainement.
      </p>

      {enfants.length === 0 ? (
        <p className="muted">Aucun enfant rattaché pour l’instant.</p>
      ) : (
        <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.25rem' }}>
          {enfants.map((enfant) => (
            <li key={enfant.id}>
              {enfant.prenom}{' '}
              <span className="muted">— né(e) le {enfant.dateNaissance}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="carte enfant-ligne" style={{ marginBottom: '0.5rem' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
          Ajouter un enfant
        </p>

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
              <span
                id={idErreur('dateNaissance')}
                className="debit"
                role="alert"
              >
                {erreurPour('dateNaissance')}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn secondaire"
          disabled={occupe || prenom.trim() === '' || dateNaissance === ''}
          onClick={() => void ajouter()}
          style={{ marginTop: '0.5rem' }}
        >
          {occupe ? 'Ajout en cours…' : '+ Ajouter cet enfant'}
        </button>
      </div>
    </fieldset>
  );
}
