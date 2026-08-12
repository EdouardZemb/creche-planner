import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useMoi } from '../session/MoiContext';
import { effacerFoyerId } from '../utils/store';
import { messageErreur } from '../utils/erreurs';
import { Bouton } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';

/** Mot à recopier pour débloquer l'action. Majuscules : la casse est comparée. */
export const MOT_DE_CONFIRMATION = 'SUPPRIMER';

/**
 * **Effacement de la famille entière** (droit à l'effacement, lot 2 ; `AM-34`).
 *
 * Trois frictions, dans cet ordre, parce que ce geste est le seul de
 * l'application qu'aucun écran ne peut réparer :
 *
 * 1. la zone est **en bas de page**, séparée du reste — on ne la croise pas ;
 * 2. la modale de confirmation **énumère ce qui part**, chiffres à l'appui, au
 *    lieu d'un « êtes-vous sûr ? » que personne ne lit ;
 * 3. l'action primaire reste **verrouillée** tant que le mot de confirmation
 *    n'est pas recopié — un Entrée réflexe ne suffit pas (le focus initial est
 *    déjà sur « Annuler », hérité de `ModaleConfirmation`).
 *
 * Après succès, l'ordre des trois gestes compte : oublier le foyer mémorisé,
 * **puis** invalider `/moi` (sans quoi l'en-tête et la racine continuent de
 * pointer vers un foyer disparu), **puis** naviguer en `replace` pour que le
 * retour arrière ne ramène pas sur une page morte.
 */
export function ZoneDangerFoyer({
  foyerId,
  nbEnfants,
  nbContrats,
}: {
  readonly foyerId: string;
  readonly nbEnfants: number;
  readonly nbContrats: number;
}) {
  const idBase = useId();
  const navigate = useNavigate();
  const moi = useMoi();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  function fermer() {
    setOuvert(false);
    setSaisie('');
  }

  async function supprimer() {
    setOccupe(true);
    setErreur(null);
    try {
      await api.supprimerFoyer(foyerId);
      fermer();
      effacerFoyerId();
      moi.recharger();
      // `navigate` peut rendre une promesse (react-router v7) : on ne l'attend
      // pas, la navigation n'a rien à rapporter à l'appelant.
      void navigate('/mes-foyers', { replace: true });
    } catch (err) {
      // On garde la modale fermée et on affiche l'échec dans la page : rouvrir
      // sur une erreur inviterait à réessayer un geste qui a peut-être abouti.
      fermer();
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="mt-5" aria-labelledby={`${idBase}-titre`}>
      <h2 id={`${idBase}-titre`}>Effacer cette famille</h2>
      <p className="muted">
        Tout ce qui est enregistré pour cette famille est effacé : enfants,
        contrats de garde, plannings, ressources et leur historique, parents,
        préférences de rappel, et les messages déjà envoyés. Les autres services
        de l’application effacent leurs copies dans la foulée.
      </p>
      <p className="muted">
        C’est <strong>définitif</strong> : rien ne permet de revenir en arrière,
        et aucune copie ne reste consultable depuis l’application.
      </p>

      <ChampErreur balise="p">{erreur}</ChampErreur>

      <Bouton
        variante="danger"
        disabled={occupe}
        onClick={() => {
          setErreur(null);
          setOuvert(true);
        }}
      >
        {occupe ? 'Effacement…' : 'Effacer cette famille'}
      </Bouton>

      <ModaleConfirmation
        ouvert={ouvert}
        titre="Effacer définitivement cette famille"
        message={resume(nbEnfants, nbContrats)}
        libelleConfirmer="Effacer définitivement"
        destructif
        confirmerDesactive={saisie !== MOT_DE_CONFIRMATION}
        onConfirmer={() => void supprimer()}
        onAnnuler={fermer}
      >
        <label htmlFor={`${idBase}-confirmation`} className="mt-3">
          Pour confirmer, tapez {MOT_DE_CONFIRMATION}
        </label>
        <input
          id={`${idBase}-confirmation`}
          type="text"
          autoComplete="off"
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value);
          }}
          style={{ width: '100%' }}
        />
      </ModaleConfirmation>
    </section>
  );
}

/**
 * Message de la modale, **contextualisé** : on annonce ce qui part réellement
 * pour cette famille-là. Une lecture des contrats en cours ou en échec laisse
 * le compte à zéro — on n'affirme alors rien de faux, on est seulement moins
 * précis.
 */
function resume(nbEnfants: number, nbContrats: number): string {
  const morceaux: string[] = [];
  if (nbEnfants > 0) {
    morceaux.push(`${String(nbEnfants)} enfant(s)`);
  }
  if (nbContrats > 0) {
    morceaux.push(`${String(nbContrats)} contrat(s) de garde`);
  }
  if (morceaux.length === 0) {
    return 'Cette famille et tout ce qui s’y rattache seront effacés définitivement.';
  }
  return `${morceaux.join(', ')} et tout l’historique de cette famille seront effacés définitivement.`;
}
