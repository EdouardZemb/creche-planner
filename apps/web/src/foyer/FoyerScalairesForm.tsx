import { Abbr } from '../ui/Abbr';
import { ChampFormulaire } from '../ui/ChampFormulaire';

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
    <fieldset className="bloc-champs" style={{ margin: 0 }}>
      <legend>Ressources de la famille</legend>

      {/* Onboarding guidé (lot 3) : lever l'inquiétude devant les champs fiscaux
          — à quoi ils servent et qu'ils restent modifiables. Partagé avec
          l'édition, qui en bénéficie aussi. */}
      <p className="muted mt-0">
        Ces informations servent uniquement à estimer le coût de la garde
        (barème CAF). Vous pourrez les modifier à tout moment.
      </p>

      <ChampFormulaire
        id="ressourcesMensuelles"
        libelle={
          <>
            Ressources mensuelles (€) <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('ressourcesMensuelles') ?? null}
        idErreur={idErreur('ressourcesMensuelles')}
      >
        {(champ) => (
          <input
            {...champ}
            type="number"
            step="0.01"
            min="0"
            required
            value={valeurs.ressourcesMensuelles}
            onChange={(e) => {
              onChange('ressourcesMensuelles', e.target.value);
            }}
            className="champ-large"
          />
        )}
      </ChampFormulaire>

      <ChampFormulaire
        id="rfr"
        libelle={
          <>
            Revenu fiscal de référence — <Abbr sigle="RFR" /> (€){' '}
            <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('rfr') ?? null}
        idErreur={idErreur('rfr')}
      >
        {(champ) => (
          <input
            {...champ}
            type="number"
            step="0.01"
            min="0"
            required
            value={valeurs.rfr}
            onChange={(e) => {
              onChange('rfr', e.target.value);
            }}
            className="champ-large"
          />
        )}
      </ChampFormulaire>

      <ChampFormulaire
        id="nbEnfantsACharge"
        libelle={
          <>
            Nombre d&apos;enfants à charge <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('nbEnfantsACharge') ?? null}
        idErreur={idErreur('nbEnfantsACharge')}
      >
        {(champ) => (
          <input
            {...champ}
            type="number"
            min="1"
            step="1"
            required
            value={valeurs.nbEnfantsACharge}
            onChange={(e) => {
              onChange('nbEnfantsACharge', e.target.value);
            }}
            className="champ-large"
          />
        )}
      </ChampFormulaire>

      <ChampFormulaire
        id="nbParts"
        libelle={
          <>
            Nombre de parts fiscales <span aria-hidden="true">*</span>
          </>
        }
        requis
        erreur={erreurPour('nbParts') ?? null}
        idErreur={idErreur('nbParts')}
      >
        {(champ) => (
          <input
            {...champ}
            type="number"
            step="0.5"
            min="0.5"
            required
            value={valeurs.nbParts}
            onChange={(e) => {
              onChange('nbParts', e.target.value);
            }}
            className="champ-large"
          />
        )}
      </ChampFormulaire>
    </fieldset>
  );
}
