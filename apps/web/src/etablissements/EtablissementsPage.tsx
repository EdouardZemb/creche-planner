import { useActionState, useId, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  EtablissementVue,
  MajEtablissement,
  PreavisRegle,
} from '../types/bff';
import { extraireErreurs, messageErreur } from '../utils/erreurs';
import { useTitrePage } from '../hooks/useTitrePage';
import { useEtablissements } from './useEtablissements';

/** Jours de la semaine pour la règle « jour + heure ». */
const JOURS = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
] as const;

type Jour = (typeof JOURS)[number];

/** Valeur texte d'un champ de formulaire (les champs de fichier sont ignorés). */
function texte(valeur: FormDataEntryValue | null): string {
  return typeof valeur === 'string' ? valeur : '';
}

/** Renarrow la valeur de formulaire `jour` vers le type `Jour` (défaut JEUDI). */
function jourDepuisForm(valeur: FormDataEntryValue | null): Jour {
  return JOURS.find((j) => j === valeur) ?? 'JEUDI';
}

/** Rend une règle de préavis en phrase lisible (récap au-dessus du formulaire). */
function decrirePreavis(regle: PreavisRegle): string {
  if (regle.type === 'JOURS_OUVRES') {
    return `${regle.valeur} jour${regle.valeur > 1 ? 's' : ''} ouvré${
      regle.valeur > 1 ? 's' : ''
    }`;
  }
  const jour = regle.jour.charAt(0) + regle.jour.slice(1).toLowerCase();
  return `${jour} avant ${regle.heure}`;
}

/** Résultat d'une soumission de formulaire (action `useActionState`). */
type EtatForm =
  | { statut: 'initial' }
  | { statut: 'ok' }
  | { statut: 'erreur'; message: string; champs: Record<string, string> };

const ETAT_INITIAL: EtatForm = { statut: 'initial' };

/**
 * Formulaire d'édition d'un établissement : adresse e-mail du service + règle de
 * préavis (jours ouvrés OU jour + heure). Soumission via `useActionState` (React
 * 19) ; les erreurs par champ remontées par le BFF sont liées en `aria-describedby`.
 */
function EtablissementForm({
  etablissement,
  onSaved,
}: {
  etablissement: EtablissementVue;
  onSaved: () => void;
}) {
  const idBase = useId();
  const [typePreavis, setTypePreavis] = useState<PreavisRegle['type']>(
    etablissement.preavisRegle.type,
  );

  const [etat, soumettre, enCours] = useActionState<EtatForm, FormData>(
    async (_prev, formData) => {
      const preavisRegle: PreavisRegle =
        formData.get('type') === 'JOUR_HEURE'
          ? {
              type: 'JOUR_HEURE',
              jour: jourDepuisForm(formData.get('jour')),
              heure: texte(formData.get('heure')),
            }
          : {
              type: 'JOURS_OUVRES',
              valeur: Number(texte(formData.get('valeur'))),
            };
      const corps: MajEtablissement = {
        emailService: texte(formData.get('emailService')),
        preavisRegle,
      };
      try {
        await api.mettreAJourEtablissement(etablissement.cle, corps);
        onSaved();
        return { statut: 'ok' };
      } catch (err) {
        const champs: Record<string, string> = {};
        if (err instanceof ApiError) {
          for (const e of extraireErreurs(err.corps)) {
            champs[e.champ] = e.message;
          }
        }
        return {
          statut: 'erreur',
          message: messageErreur(err),
          champs,
        };
      }
    },
    ETAT_INITIAL,
  );

  function idErreur(champ: string): string {
    return `${idBase}-${champ}-err`;
  }
  function erreurPour(champ: string): string | undefined {
    return etat.statut === 'erreur' ? etat.champs[champ] : undefined;
  }

  const heureDefaut =
    etablissement.preavisRegle.type === 'JOUR_HEURE'
      ? etablissement.preavisRegle.heure
      : '12:00';
  const jourDefaut =
    etablissement.preavisRegle.type === 'JOUR_HEURE'
      ? etablissement.preavisRegle.jour
      : 'JEUDI';
  const valeurDefaut =
    etablissement.preavisRegle.type === 'JOURS_OUVRES'
      ? etablissement.preavisRegle.valeur
      : 2;

  return (
    <section className="carte" style={{ maxWidth: 600, marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>{etablissement.libelle}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Préavis actuel : {decrirePreavis(etablissement.preavisRegle)}
      </p>

      {etat.statut === 'ok' && (
        <p className="credit" role="status">
          Modifications enregistrées.
        </p>
      )}
      {etat.statut === 'erreur' && Object.keys(etat.champs).length === 0 && (
        <p className="debit" role="alert">
          {etat.message}
        </p>
      )}

      <form action={soumettre}>
        <label htmlFor={`${idBase}-email`}>
          Adresse e-mail du service <span aria-hidden="true">*</span>
        </label>
        <input
          id={`${idBase}-email`}
          name="emailService"
          type="email"
          required
          aria-required="true"
          aria-invalid={erreurPour('emailService') ? true : undefined}
          {...(erreurPour('emailService')
            ? { 'aria-describedby': idErreur('emailService') }
            : {})}
          defaultValue={etablissement.emailService}
          style={{ width: '100%' }}
        />
        {erreurPour('emailService') && (
          <span id={idErreur('emailService')} className="debit" role="alert">
            {erreurPour('emailService')}
          </span>
        )}

        <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Règle de préavis
          </legend>

          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <input
              type="radio"
              name="type"
              value="JOURS_OUVRES"
              checked={typePreavis === 'JOURS_OUVRES'}
              onChange={() => {
                setTypePreavis('JOURS_OUVRES');
              }}
            />
            En jours ouvrés
          </label>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <input
              type="radio"
              name="type"
              value="JOUR_HEURE"
              checked={typePreavis === 'JOUR_HEURE'}
              onChange={() => {
                setTypePreavis('JOUR_HEURE');
              }}
            />
            Un jour + une heure butoir
          </label>

          {typePreavis === 'JOURS_OUVRES' ? (
            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor={`${idBase}-valeur`}>Nombre de jours ouvrés</label>
              <input
                id={`${idBase}-valeur`}
                name="valeur"
                type="number"
                min={0}
                max={30}
                step={1}
                required
                defaultValue={valeurDefaut}
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <div
              style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              <div style={{ flex: 1 }}>
                <label htmlFor={`${idBase}-jour`}>Jour</label>
                <select
                  id={`${idBase}-jour`}
                  name="jour"
                  defaultValue={jourDefaut}
                  style={{ width: '100%' }}
                >
                  {JOURS.map((j) => (
                    <option key={j} value={j}>
                      {j.charAt(0) + j.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor={`${idBase}-heure`}>Heure butoir</label>
                <input
                  id={`${idBase}-heure`}
                  name="heure"
                  type="time"
                  required
                  defaultValue={heureDefaut}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}
        </fieldset>

        <div style={{ marginTop: '1.5rem' }}>
          <button type="submit" className="btn" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Écran de configuration des établissements destinataires. Liste les
 * établissements seedés (crèche / ABCM) avec un formulaire d'édition par
 * établissement (adresse du service + règle de préavis).
 */
export function EtablissementsPage() {
  useTitrePage('Établissements');
  const [version, setVersion] = useState(0);
  const { data, loading, error, reload } = useEtablissements(version);

  return (
    <div>
      <h1>Établissements destinataires</h1>
      <p className="muted">
        Adresse et règle de préavis de chaque établissement (crèche, ABCM)
        destinataire des récapitulatifs envoyés au service.
      </p>

      {/* Chargement initial uniquement : un rechargement après enregistrement
          garde la liste affichée (sinon les formulaires se démontent et le
          message de confirmation disparaîtrait). */}
      {loading && !data && (
        <div className="carte muted" aria-live="polite">
          Chargement des établissements…
        </div>
      )}

      {!loading && error && !data && (
        <div className="carte" role="alert">
          <p style={{ color: 'var(--rouge)', margin: '0 0 0.5rem' }}>{error}</p>
          <button type="button" className="btn secondaire" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {data?.map((e) => (
        <EtablissementForm
          key={e.cle}
          etablissement={e}
          onSaved={() => {
            setVersion((v) => v + 1);
          }}
        />
      ))}

      {!loading && !error && data?.length === 0 && (
        <div className="carte muted">Aucun établissement configuré.</div>
      )}
    </div>
  );
}
