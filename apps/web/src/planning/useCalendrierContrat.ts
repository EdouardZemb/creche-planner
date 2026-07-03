import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type {
  ContratLocal,
  CreerContrat,
  LienEtablissementSaisie,
} from '../types/bff';
import { messageErreur } from '../utils/erreurs';
import { formaterHeureFr } from '../utils/dates';
import { useAnnonce } from '../hooks/useAnnonce';
import { usePlanning, type EtatEnregistrement } from './usePlanning';
import { useSaisieServeur } from './useSaisieServeur';
import type { Portee } from './ChoixPortee';

// Enveloppe commune des calendriers mensuels (`CalendrierCreche`,
// `CalendrierAbcm`) : écriture de planning debouncée + statut, réhydratation
// serveur, annonces lecteurs d'écran, période de validité, portée de saisie et
// flux de modification durable du contrat (PUT + confirmation + erreur). La
// logique métier de chaque mode (formulaires, dérivation des saisies) reste
// dans le calendrier concerné.

/** Socle commun (PUT contrat) : identité, période et lien établissement. */
export interface SocleContratDurable extends LienEtablissementSaisie {
  foyerId: string;
  enfant: string;
  valideDu: string;
  valideAu: string | null;
}

/**
 * Champs RECONDUITS du contrat courant lors d'un remplacement complet (PUT).
 * Le lien établissement est OBLIGATOIRE depuis P5 (`etablissement_id` NOT
 * NULL) → on reconduit celui du contrat, sinon le service rejette en 400.
 */
export function socleContratDurable(
  contrat: ContratLocal,
): SocleContratDurable {
  return {
    foyerId: contrat.foyerId,
    enfant: contrat.enfant,
    valideDu: contrat.valideDu,
    valideAu: contrat.valideAu,
    ...(contrat.etablissementId
      ? { etablissementId: contrat.etablissementId }
      : {}),
  };
}

/** Modification durable en attente de confirmation (payload propre au mode). */
export interface ConfirmationDurable<P> {
  payload: P;
  message: string;
}

export interface UseCalendrierContratOptions<P> {
  contrat: ContratLocal;
  mois: string;
  simule: boolean;
  onEnregistre: () => void;
  /** Appelé après une modification durable du contrat (recharge nécessaire). */
  onContratModifie?: (() => void) | undefined;
  /** Corps complet du PUT contrat pour un payload confirmé (mode-spécifique). */
  construireCorpsDurable: (
    payload: P,
  ) => CreerContrat & LienEtablissementSaisie;
  /** Remet à zéro la saisie locale du mois après un PUT contrat réussi. */
  reinitialiserSaisie: () => void;
}

export interface UseCalendrierContratResultat<P> {
  // Écriture de planning debouncée (usePlanning) + statut affichable. L'état
  // complet (dont « en-cours ») alimente la barre de statut : le badge couvre
  // aussi le trou debounce → réponse serveur (UX lot 3).
  ecrire: ReturnType<typeof usePlanning>['ecrire'];
  etat: EtatEnregistrement;
  erreur: string | null;
  /** Heure « 21:43 » du dernier enregistrement abouti (badge persistant). */
  enregistreA: string | null;
  /** Rejoue la dernière écriture demandée (reprise après « erreur »). */
  reessayer: () => void;

  // Réhydratation serveur (source de vérité multi-poste).
  saisieServeur: ReturnType<typeof useSaisieServeur>['saisie'];
  chargee: boolean;

  // AQ-05 : annonces des mutations aux lecteurs d'écran.
  annoncer: (texte: string) => void;
  regionLiveProps: ReturnType<typeof useAnnonce>['regionLiveProps'];

  /** Vrai si le jour ISO est dans la période de validité du contrat. */
  estDansPeriode: (iso: string) => boolean;

  // Portée de la saisie en cours (« ce mois » / « tous les X »).
  portee: Portee;
  setPortee: (portee: Portee) => void;

  // Modification durable du contrat (PUT) : confirmation puis application.
  confirmationDurable: ConfirmationDurable<P> | null;
  demanderConfirmationDurable: (payload: P, message: string) => void;
  confirmerDurable: () => void;
  annulerDurable: () => void;
  erreurDurable: string | null;
  /**
   * Confirmation VISIBLE d'une modification durable aboutie (la cascade
   * serveur réinitialise les saisies du mois en silence : sans ce message, le
   * parent voit son calendrier changer sans explication — UX lot 4). Persiste
   * jusqu'à la demande durable suivante, comme le badge « Enregistré à ».
   */
  succesDurable: string | null;
}

/** Enveloppe commune d'un calendrier mensuel adossé à un contrat. */
export function useCalendrierContrat<P>({
  contrat,
  mois,
  simule,
  onEnregistre,
  onContratModifie,
  construireCorpsDurable,
  reinitialiserSaisie,
}: UseCalendrierContratOptions<P>): UseCalendrierContratResultat<P> {
  const { etat, erreur, enregistreA, ecrire, reessayer } =
    usePlanning(onEnregistre);
  const { annoncer, regionLiveProps } = useAnnonce();
  const { saisie: saisieServeur, chargee } = useSaisieServeur(
    contrat.id,
    mois,
    simule,
  );

  const [portee, setPortee] = useState<Portee>('mois');

  // Erreur d'une modification durable (PUT contrat) : affichée sans détruire
  // l'état local. L'opération est atomique côté service (transaction Drizzle) et
  // un 429 est rejeté par la gateway avant tout effet → le contrat reste intact.
  const [erreurDurable, setErreurDurable] = useState<string | null>(null);
  const [succesDurable, setSuccesDurable] = useState<string | null>(null);
  const [confirmationDurable, setConfirmationDurable] =
    useState<ConfirmationDurable<P> | null>(null);

  const estDansPeriode = useCallback(
    (iso: string): boolean =>
      iso >= contrat.valideDu &&
      (contrat.valideAu === null || iso <= contrat.valideAu),
    [contrat.valideDu, contrat.valideAu],
  );

  const demanderConfirmationDurable = useCallback(
    (payload: P, message: string) => {
      // Une nouvelle demande périme la confirmation de succès précédente.
      setSuccesDurable(null);
      setConfirmationDurable({ payload, message });
    },
    [],
  );

  // Applique la modification durable confirmée (modifie le contrat).
  const appliquerDurable = useCallback(
    (payload: P) => {
      setErreurDurable(null);
      api
        .modifierContrat(contrat.id, construireCorpsDurable(payload))
        .then(() => {
          setErreurDurable(null);
          reinitialiserSaisie();
          // Message visible détaillé ; l'annonce lecteur d'écran (AQ-05) reste
          // courte et passe par la région live existante (pas de double live).
          setSuccesDurable(
            `Contrat modifié à ${formaterHeureFr(new Date())}. Les saisies de ce mois ont été effacées : le calendrier repart du nouveau contrat.`,
          );
          annoncer('Contrat modifié, saisies du mois réinitialisées');
          onContratModifie?.();
        })
        .catch((e: unknown) => {
          // Échec (429, réseau, validation…) : le contrat n'a PAS été modifié
          // (PUT atomique + court-circuit gateway). On signale l'erreur sans
          // toucher à l'état local — l'utilisateur peut réessayer.
          setErreurDurable(messageErreur(e));
        });
    },
    [
      contrat.id,
      construireCorpsDurable,
      reinitialiserSaisie,
      annoncer,
      onContratModifie,
    ],
  );

  const confirmerDurable = useCallback(() => {
    if (confirmationDurable) {
      appliquerDurable(confirmationDurable.payload);
    }
    setConfirmationDurable(null);
  }, [confirmationDurable, appliquerDurable]);

  const annulerDurable = useCallback(() => {
    setConfirmationDurable(null);
  }, []);

  return {
    ecrire,
    etat,
    erreur,
    enregistreA,
    reessayer,
    saisieServeur,
    chargee,
    annoncer,
    regionLiveProps,
    estDansPeriode,
    portee,
    setPortee,
    confirmationDurable,
    demanderConfirmationDurable,
    confirmerDurable,
    annulerDurable,
    erreurDurable,
    succesDurable,
  };
}
