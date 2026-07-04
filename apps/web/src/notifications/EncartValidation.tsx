import { useState } from 'react';
import { api } from '../api/client';
import type { NotificationAValider } from '../types/bff';
import { messageErreur } from '../utils/erreurs';
import { libelleMode } from '../utils/libelles';
import { libelleSemaine } from '../utils/dates';
import { useNotifications } from './useNotifications';
import { RelectureEnvoi } from './RelectureEnvoi';
import { EditeurSemaine } from './EditeurSemaine';

/**
 * Cible « enfant, mode » d'une notification enrichie (`Zoé, Crèche`), ou `null` si le
 * BFF n'a pas pu enrichir (contrat introuvable). Sert à distinguer N lignes d'une même
 * semaine, aussi bien à l'écran que dans les `aria-label` des boutons.
 */
function cibleContrat(n: NotificationAValider): string | null {
  return n.enfant && n.mode ? `${n.enfant}, ${libelleMode(n.mode)}` : null;
}

/** Libellé d'une ligne : « Zoé — Crèche · semaine du 6 au 12 juillet » ou repli sans enfant. */
function libelleLigne(n: NotificationAValider): string {
  const semaine = libelleSemaine(n.semaineIso);
  return n.enfant && n.mode
    ? `${n.enfant} — ${libelleMode(n.mode)} · ${semaine}`
    : `Planning de la ${semaine}`;
}

/**
 * `aria-label` distinct d'un bouton (« Valider la semaine du 6 au 12 juillet — Zoé, Crèche »),
 * ou `undefined` si la notif n'est pas enrichie — on garde alors le libellé visible du
 * bouton comme nom accessible. Quand plusieurs lignes partagent la même semaine, le
 * suffixe enfant/mode rend chaque cible unique pour les technologies d'assistance (même
 * esprit que les libellés datés de `EditeurContratSemaine`).
 */
function ariaLabel(
  prefixe: string,
  n: NotificationAValider,
): string | undefined {
  const cible = cibleContrat(n);
  return cible
    ? `${prefixe} ${libelleSemaine(n.semaineIso)} — ${cible}`
    : undefined;
}

/**
 * Retour affiché après une tentative de validation. Le type pilote la couleur
 * (`credit` vert / `debit` rouge) et le rôle ARIA ; en cas d'erreur, `notif`
 * retient la ligne concernée pour proposer « Réessayer » sans re-chercher.
 */
interface RetourValidation {
  type: 'succes' | 'erreur';
  texte: string;
  notif?: NotificationAValider;
}

/**
 * Encart « Valider la semaine suivante » en tête du planning (Lot 4). Liste les
 * semaines `A_VALIDER` du foyer et propose de les valider d'un clic. Après une
 * validation, la liste se recharge (la semaine validée disparaît) et un message
 * indique si le planning a été validé tel quel ou **avec modifications**. Tant
 * qu'il n'y a rien à valider (cas nominal hors notification du mardi), l'encart
 * ne s'affiche pas — il n'encombre pas la page.
 */
export function EncartValidation({ foyerId }: { foyerId: string }) {
  const [version, setVersion] = useState(0);
  const { data, loading } = useNotifications(foyerId, version);
  // Contrat en cours de validation (clé = `contratId`, PAS la semaine) : sinon valider un
  // contrat désactiverait les boutons de TOUS les contrats de la même semaine.
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<RetourValidation | null>(null);
  // Semaine validée AVEC modifications : on propose alors d'envoyer les récaps **agrégés
  // par établissement** (Phase 4) au foyer pour cette semaine. `null` tant qu'aucune ne
  // le requiert. On retient la semaine (le récap est désormais foyer + établissement,
  // plus contrat).
  const [aEnvoyer, setAEnvoyer] = useState<string | null>(null);
  // Semaine en cours d'édition (vue hebdo consolidée du foyer). `null` = repliée.
  const [semaineEditee, setSemaineEditee] = useState<string | null>(null);

  // Chargement initial : l'encart s'affiche avec un placeholder plutôt que
  // rien — invisible, on ne savait pas s'il n'y avait rien à valider ou si la
  // vérification était en cours, et l'encart « sautait » à l'écran en
  // apparaissant une fois chargé. Aucune semaine à valider : pas d'encart. On
  // reste en revanche affiché tant qu'un retour (succès/erreur) ou un envoi
  // aux services est en cours de lecture : valider la DERNIÈRE semaine vidait
  // l'encart d'un coup, confirmation comprise — le parent ne savait plus si ça
  // avait marché.
  const enChargement = loading && data === null;
  const semaines = data ?? [];
  if (
    !enChargement &&
    semaines.length === 0 &&
    retour === null &&
    aEnvoyer === null
  ) {
    return null;
  }

  const valider = async (n: NotificationAValider): Promise<void> => {
    setEnCours(n.contratId);
    setRetour(null);
    try {
      const resultat = await api.validerSemaine(n.contratId, n.semaineIso);
      const avecModifs = resultat.statut === 'VALIDEE_AVEC_MODIFS';
      // Le message nomme l'enfant quand on le connaît, pour qu'on sache QUELLE ligne a
      // été validée (plusieurs contrats peuvent partager la même semaine).
      const quoi = n.enfant
        ? `${n.enfant} — ${libelleSemaine(n.semaineIso)}`
        : `Planning de la ${libelleSemaine(n.semaineIso)}`;
      // Avec modifications, valider ne suffit pas : le service doit encore être
      // prévenu. Le message nomme explicitement cette dernière étape, sinon le
      // parent peut quitter la page en croyant (à tort) que tout est terminé.
      setRetour({
        type: 'succes',
        texte: avecModifs
          ? `${quoi} validé (avec modifications). Dernière étape : prévenir le service ci-dessous.`
          : `${quoi} validé.`,
      });
      // Avec modifications, on doit prévenir les services : on garde la semaine pour
      // proposer la relecture/envoi agrégé (pas d'envoi automatique — relecture obligatoire).
      setAEnvoyer(avecModifs ? n.semaineIso : null);
      setVersion((v) => v + 1);
    } catch (err) {
      setRetour({ type: 'erreur', texte: messageErreur(err), notif: n });
    } finally {
      setEnCours(null);
    }
  };

  return (
    <section
      className="carte"
      aria-label="Semaines de planning à valider"
      aria-busy={enChargement}
      style={{ borderLeft: '4px solid var(--bleu)', marginBottom: '1rem' }}
    >
      <h2 style={{ marginTop: 0, fontSize: 'var(--h2)' }}>
        Valider la semaine suivante
      </h2>
      {enChargement && (
        <p className="muted spinner" style={{ margin: 0 }}>
          <span className="spinner-roue" aria-hidden="true" />
          Vérification des semaines à valider…
        </p>
      )}
      {retour !== null && retour.type === 'succes' && (
        <p className="credit" role="status">
          {retour.texte}
        </p>
      )}
      {retour !== null && retour.type === 'erreur' && (
        <p className="debit" role="alert">
          {retour.texte}{' '}
          {retour.notif !== undefined && (
            <button
              type="button"
              className="btn secondaire"
              onClick={() => {
                if (retour.notif) void valider(retour.notif);
              }}
            >
              Réessayer
            </button>
          )}
        </p>
      )}
      {/* Liste vidée après la dernière validation : on le dit explicitement au
          lieu de faire disparaître l'encart (le parent doit voir que c'est fini,
          pas deviner). */}
      {!enChargement && semaines.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Plus rien à valider pour le moment.
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {semaines.map((n) => (
          <li key={`${n.contratId}-${n.semaineIso}`} className="encart-ligne">
            <span>{libelleLigne(n)}</span>
            {/* Boutons empilés pleine largeur sous ~480px (cf. .encart-actions). */}
            <span className="encart-actions">
              <button
                type="button"
                className="btn secondaire"
                aria-expanded={semaineEditee === n.semaineIso}
                aria-label={ariaLabel('Éditer la', n)}
                onClick={() => {
                  setSemaineEditee((s) =>
                    s === n.semaineIso ? null : n.semaineIso,
                  );
                }}
              >
                {semaineEditee === n.semaineIso
                  ? 'Fermer l’éditeur'
                  : 'Éditer la semaine'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={enCours === n.contratId}
                aria-label={ariaLabel('Valider la', n)}
                onClick={() => {
                  void valider(n);
                }}
              >
                {enCours === n.contratId ? 'Validation…' : 'Valider'}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {/* Éditeur hebdomadaire consolidé (foyer + semaine), ouvert à la demande.
          La validation reste par contrat, présentée à l'intérieur de l'éditeur. */}
      {semaineEditee !== null && (
        <EditeurSemaine
          foyerId={foyerId}
          semaineIso={semaineEditee}
          onFermer={() => {
            setSemaineEditee(null);
          }}
        />
      )}

      {aEnvoyer !== null && (
        <RelectureEnvoi foyerId={foyerId} semaineIso={aEnvoyer} />
      )}
    </section>
  );
}
