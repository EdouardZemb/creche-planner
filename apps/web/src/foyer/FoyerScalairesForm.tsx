import { Abbr } from '../ui/Abbr';

/** Valeurs (chaînes de saisie) des scalaires d'un foyer, telles qu'éditées dans le formulaire. */
export interface ValeursScalairesFoyer {
  ressourcesMensuelles: string;
  rfr: string;
  nbEnfantsACharge: string;
  nbParts: string;
}

/** Champ scalaire éditable du foyer (clé de `ValeursScalairesFoyer`). */
export type ChampScalaireFoyer = keyof ValeursScalairesFoyer;

interface FoyerScalairesFormProps {
  readonly valeurs: ValeursScalairesFoyer;
  readonly onChange: (champ: ChampScalaireFoyer, valeur: string) => void;
  /** Message d'erreur serveur rattaché à un champ (`undefined` si aucun). */
  readonly erreurPour: (champ: string) => string | undefined;
  /** Id du message d'erreur d'un champ, pour le lier via `aria-describedby`. */
  readonly idErreur: (champ: string) => string;
}

/**
 * Sous-formulaire **partagé** des scalaires d'un foyer (ressources, RFR, nb
 * enfants à charge, nb parts), extrait de `FoyerFormPage` pour être réutilisé à
 * l'édition (`FoyerModifierPage`) sans dupliquer la validation, les libellés ni
 * les attributs ARIA (liaison erreur ↔ champ via `aria-describedby`).
 *
 * Composant **contrôlé** : l'état de saisie, la conversion euros→nombre et la
 * soumission restent chez la page hôte (création vs édition).
 */
export function FoyerScalairesForm({
  valeurs,
  onChange,
  erreurPour,
  idErreur,
}: FoyerScalairesFormProps) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
        Ressources du foyer
      </legend>

      {/* Onboarding guidé (lot 3) : lever l'inquiétude devant les champs fiscaux
          — à quoi ils servent et qu'ils restent modifiables. Partagé avec
          l'édition, qui en bénéficie aussi. */}
      <p className="muted" style={{ marginTop: 0 }}>
        Ces informations servent uniquement à estimer le coût de la garde
        (barème CAF). Vous pourrez les modifier à tout moment.
      </p>

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
        value={valeurs.ressourcesMensuelles}
        onChange={(e) => {
          onChange('ressourcesMensuelles', e.target.value);
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
        {...(erreurPour('rfr') ? { 'aria-describedby': idErreur('rfr') } : {})}
        value={valeurs.rfr}
        onChange={(e) => {
          onChange('rfr', e.target.value);
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
        value={valeurs.nbEnfantsACharge}
        onChange={(e) => {
          onChange('nbEnfantsACharge', e.target.value);
        }}
        style={{ width: '100%' }}
      />
      {erreurPour('nbEnfantsACharge') && (
        <span id={idErreur('nbEnfantsACharge')} className="debit" role="alert">
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
        value={valeurs.nbParts}
        onChange={(e) => {
          onChange('nbParts', e.target.value);
        }}
        style={{ width: '100%' }}
      />
      {erreurPour('nbParts') && (
        <span id={idErreur('nbParts')} className="debit" role="alert">
          {erreurPour('nbParts')}
        </span>
      )}
    </fieldset>
  );
}
