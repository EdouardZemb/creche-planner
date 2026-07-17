import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type {
  BrouillonEtablissement,
  ContratBesoinsSemaine,
  DeltaJour,
  EnfantBrouillon,
  EnvoiEtablissementResultat,
} from '../types/bff';
import { messageErreur } from '../utils/erreurs';
import { dateLongueFr } from '../utils/dates';
import { useAsync } from '../hooks/useAsync';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { composerBrouillonSemaineComplete } from './brouillonSemaineComplete';

/** Bornes de saisie du mail au service, alignées sur le DTO svc-notifications (L8). */
const OBJET_MAX = 300;
const CORPS_MAX = 20000;

/**
 * Courte description d'un jour modifié pour la relecture, en mots de parent :
 * « mardi 1 juillet — modifiée » (date longue + nature du changement). Un jour
 * portant des heures réelles ajustées (Lot 2a/2b) est annoncé « horaires ajustés »
 * plutôt que « modifiée ». `apres` est de forme libre (relayée par la gateway) : on
 * lit `ajustements` défensivement (absent ≡ vide).
 */
function descriptionJour(jour: DeltaJour): string {
  const dateLongue = dateLongueFr(jour.date);
  if (jour.apres === null) {
    return `${dateLongue} — journée retirée`;
  }
  const ajustements = (jour.apres as { ajustements?: readonly unknown[] })
    .ajustements;
  if (ajustements !== undefined && ajustements.length > 0) {
    return `${dateLongue} — horaires ajustés`;
  }
  return `${dateLongue} — modifiée`;
}

/**
 * Vrai uniquement pour une issue **terminale de succès** (`ENVOYE`/`DRY_RUN`). Un statut
 * `EN_COURS` (envoi concurrent réellement en vol, renvoyé par la reprise côté service) ou
 * `ECHEC` n'est **jamais** un succès : ni message vert, ni bouton figé sur « Envoyé ».
 */
function estAbouti(r: EnvoiEtablissementResultat): boolean {
  return r.statut === 'ENVOYE' || r.statut === 'DRY_RUN';
}

/** Message de résultat selon l'issue réelle de l'envoi. */
function libelleResultat(r: EnvoiEtablissementResultat): string {
  switch (r.statut) {
    case 'DRY_RUN':
      return `Test réussi : aucun mail n'a vraiment été envoyé à ${r.destinataire}.`;
    case 'ENVOYE':
      return `C'est fait : le service est prévenu (mail envoyé à ${r.destinataire}).`;
    case 'ECHEC':
      return `Échec de l'envoi : ${r.erreur ?? 'erreur inconnue'}.`;
    default:
      return `Un envoi est déjà en cours vers ${r.destinataire}. Patientez un instant, puis réessayez si le service n'a pas été prévenu.`;
  }
}

/**
 * Liste « Enfants concernés » (prénom + jours modifiés) d'un établissement. Partagée
 * par le bloc d'envoi (établissement joignable) et la carte d'avertissement
 * (non joignable) : dans les deux cas, le parent voit **ce qui** change pour cette
 * crèche — y compris quand ce ne sera pas transmis.
 */
function ListeEnfantsConcernes({
  enfants,
}: {
  enfants: readonly EnfantBrouillon[];
}) {
  return (
    <>
      <p className="relecture-enfants-titre">Enfants concernés :</p>
      <ul className="relecture-enfants">
        {enfants.map((enfant) => (
          <li key={enfant.contratId}>
            <strong>{enfant.enfant}</strong>
            {enfant.deltaModifs.jours.length > 0 && (
              <ul>
                {enfant.deltaModifs.jours.map((j) => (
                  <li key={j.date}>{descriptionJour(j)}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Bloc de relecture + envoi pour **un établissement joignable** : liste les enfants
 * concernés et leurs jours modifiés, affiche le destinataire en évidence, le bandeau
 * « Mode test » (dry-run), puis ne déclenche l'**action sortante réelle** qu'après une
 * confirmation explicite.
 */
function BlocEnvoiEtablissement({
  foyerId,
  semaineIso,
  jours,
  contrats,
  brouillon,
}: {
  foyerId: string;
  semaineIso: string;
  jours: readonly string[];
  contrats: readonly ContratBesoinsSemaine[];
  brouillon: BrouillonEtablissement;
}) {
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{
    type: 'succes' | 'erreur';
    texte: string;
  } | null>(null);
  const [envoye, setEnvoye] = useState(false);

  // Brouillon pré-rempli : la SEMAINE COMPLÈTE (7 jours) de chaque enfant
  // concerné, bien formulée. Le parent part de ce texte et peut tout réécrire —
  // c'est son texte exact qui part (L8 achemine `sujet`/`corps`).
  const propose = composerBrouillonSemaineComplete({
    jours,
    contrats,
    brouillon,
  });
  const [sujet, setSujet] = useState(propose.sujet);
  const [corps, setCorps] = useState(propose.corps);

  const idObjet = useId();
  const idMessage = useId();

  // Mêmes bornes que le DTO svc (L8) : non vide (hors espaces) et longueur bornée.
  const messageValidation =
    sujet.trim().length === 0
      ? 'L’objet ne peut pas être vide.'
      : sujet.length > OBJET_MAX
        ? `L’objet est trop long (${String(OBJET_MAX)} caractères maximum).`
        : corps.trim().length === 0
          ? 'Le message ne peut pas être vide.'
          : corps.length > CORPS_MAX
            ? `Le message est trop long (${String(CORPS_MAX)} caractères maximum).`
            : null;
  const valide = messageValidation === null;

  const envoyer = async (): Promise<void> => {
    setConfirmer(false);
    setEnCours(true);
    setMessage(null);
    try {
      const resultat = await api.envoyerRecapEtablissement(
        foyerId,
        semaineIso,
        brouillon.etablissementId,
        { sujet, corps },
      );
      const abouti = estAbouti(resultat);
      setMessage({
        type: abouti ? 'succes' : 'erreur',
        texte: libelleResultat(resultat),
      });
      // Un statut ECHEC — ou EN_COURS (envoi concurrent en vol renvoyé par la reprise) —
      // laissait le bouton verrouillé sur « Envoyé » alors que rien n'était (encore)
      // parti : on ne fige l'état qu'après un envoi réellement abouti.
      setEnvoye(abouti);
    } catch (err) {
      setMessage({ type: 'erreur', texte: messageErreur(err) });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="bloc-etablissement">
      <h4 className="bloc-etablissement-titre">
        {brouillon.etablissementLibelle}
      </h4>

      {brouillon.dryRun && (
        <p role="status" className="bandeau-test">
          <strong>Mode test</strong> — aucun mail ne sera vraiment envoyé ; vous
          pouvez essayer sans risque.
        </p>
      )}

      <p className="relecture-champ">
        Destinataire : <strong>{brouillon.destinataire}</strong>
      </p>

      <ListeEnfantsConcernes enfants={brouillon.enfants} />

      <div className="relecture-editeur">
        <label htmlFor={idObjet}>Objet</label>
        <input
          id={idObjet}
          type="text"
          value={sujet}
          maxLength={OBJET_MAX}
          onChange={(e) => {
            setSujet(e.target.value);
          }}
        />

        <label htmlFor={idMessage}>Message au service</label>
        <textarea
          id={idMessage}
          className="relecture-message"
          value={corps}
          rows={14}
          maxLength={CORPS_MAX}
          onChange={(e) => {
            setCorps(e.target.value);
          }}
        />

        <button
          type="button"
          className="btn secondaire"
          onClick={() => {
            setSujet(propose.sujet);
            setCorps(propose.corps);
          }}
        >
          Rétablir le texte proposé
        </button>
      </div>

      {messageValidation !== null && (
        <p className="debit" role="alert">
          {messageValidation}
        </p>
      )}

      {message !== null && (
        <p
          className={message.type === 'succes' ? 'credit' : 'debit'}
          role={message.type === 'succes' ? 'status' : 'alert'}
        >
          {message.texte}
        </p>
      )}

      <button
        type="button"
        className="btn"
        disabled={enCours || envoye || !valide}
        aria-label={`Envoyer le récapitulatif à ${brouillon.etablissementLibelle}`}
        onClick={() => {
          setConfirmer(true);
        }}
      >
        {enCours
          ? 'Envoi…'
          : envoye
            ? 'Envoyé ✓'
            : message?.type === 'erreur'
              ? `Réessayer l'envoi`
              : `Envoyer à ${brouillon.etablissementLibelle}`}
      </button>

      <ModaleConfirmation
        ouvert={confirmer}
        titre="Envoyer le récapitulatif au service ?"
        message={
          brouillon.dryRun
            ? `Mode test : aucun mail ne sera vraiment envoyé à ${brouillon.destinataire}.`
            : `Un mail va vraiment être envoyé à ${brouillon.destinataire}. Cette action est irréversible.`
        }
        libelleConfirmer={
          brouillon.dryRun ? 'Envoyer (mode test)' : 'Envoyer le mail'
        }
        destructif={!brouillon.dryRun}
        onConfirmer={() => {
          void envoyer();
        }}
        onAnnuler={() => {
          setConfirmer(false);
        }}
      />
    </div>
  );
}

/**
 * Carte d'avertissement pour un établissement **concerné mais non joignable** (angles
 * morts « crèche sans e-mail », Lot 2, et « crèche archivée », Lot 3). Plus d'échec
 * silencieux : la crèche apparaît explicitement, sans bouton d'envoi, avec le rappel de
 * ce qui ne sera pas transmis et un raccourci pour lever l'obstacle. Le message et le
 * raccourci dépendent de la raison : « Ajouter un e-mail » (sans e-mail) ou
 * « Réactiver » (archivée). Les deux pointent vers l'écran « Crèches & écoles ».
 */
function CarteNonRoutable({
  foyerId,
  brouillon,
}: {
  foyerId: string;
  brouillon: BrouillonEtablissement;
}) {
  const archive = brouillon.raisonNonRoutable === 'ARCHIVE';
  const alerte = archive
    ? `« ${brouillon.etablissementLibelle} » est archivée : réactivez-la pour la prévenir.`
    : `« ${brouillon.etablissementLibelle} » n’a pas d’e-mail : cette crèche ne sera pas prévenue de vos changements.`;
  const libelleLien = archive ? 'Réactiver' : 'Ajouter un e-mail';
  return (
    <div className="bloc-etablissement">
      <h4 className="bloc-etablissement-titre">
        {brouillon.etablissementLibelle}
      </h4>

      <div role="note" className="carte-non-routable">
        <p className="carte-non-routable-alerte">
          <span aria-hidden="true">⚠️ </span>
          {alerte}
        </p>
        <Link
          to={`/foyers/${foyerId}/etablissements`}
          className="btn secondaire"
        >
          {libelleLien}
        </Link>
      </div>

      <ListeEnfantsConcernes enfants={brouillon.enfants} />
    </div>
  );
}

/**
 * Relecture humaine **obligatoire** puis envoi des mails **agrégés par établissement**
 * (édition hebdo, Phase 4). Pour le foyer et la semaine, on découvre d'abord les
 * **établissements réels concernés** (entité libre par foyer, lien explicite
 * `contrat.etablissementId`) via la vue `semaine/besoins`, puis on charge le brouillon
 * agrégé de chacun par son `id`. On n'affiche un bloc que pour ceux qui ont **au moins
 * un enfant** validé avec modifications. Un établissement **joignable** déclenche un
 * **mail unique** après confirmation explicite ; un établissement **non joignable** (sans
 * e-mail) est signalé en avertissement — jamais écarté silencieusement, jamais envoyé à
 * vide. Un bandeau « Mode test » avertit quand l'envoi serait neutralisé (dry-run).
 */
export function RelectureEnvoi({
  foyerId,
  semaineIso,
}: {
  foyerId: string;
  semaineIso: string;
}) {
  const { data, loading, error } = useAsync(
    async (signal) => {
      const semaine = await api.lireSemaineBesoins(foyerId, semaineIso, {
        signal,
      });
      // Un brouillon par établissement concerné, routé par son `id`. `allSettled` :
      // une erreur réseau/404 (établissement inconnu) sur l'un n'empêche pas de relire
      // les autres. Un établissement sans e-mail ne 404 **plus** : il revient
      // `routable:false` et est rendu en avertissement (angle mort fermé, Lot 2).
      const brouillons = await Promise.allSettled(
        semaine.etablissements.map((e) =>
          api.lireBrouillonEtablissement(
            foyerId,
            semaineIso,
            e.etablissementId,
            {
              signal,
            },
          ),
        ),
      );
      // La vue `semaine/besoins` porte DÉJÀ les 7 jours et les contrats datés
      // (aucun nouveau fetch) : on les propage au bloc d'envoi pour composer le
      // brouillon « semaine complète » de chaque enfant concerné (L9).
      return {
        jours: semaine.jours,
        contrats: semaine.contrats,
        brouillons: brouillons.flatMap((r) =>
          r.status === 'fulfilled' ? [r.value] : [],
        ),
      };
    },
    [foyerId, semaineIso],
  );

  // On n'affiche un établissement que s'il a au moins un enfant concerné — qu'il soit
  // joignable (bloc d'envoi) ou non (carte d'avertissement).
  const concernes = (data?.brouillons ?? []).filter(
    (b) => b.enfants.length > 0,
  );

  // La section apparaît APRÈS que le parent a tapé « Valider » : sans coup de
  // pouce, elle peut rester hors écran sur mobile et l'étape d'envoi passe
  // inaperçue (le service ne serait jamais prévenu). Le focus programmatique
  // amène à la fois le scroll et la lecture d'écran sur la section.
  const refSection = useRef<HTMLElement | null>(null);
  useEffect(() => {
    refSection.current?.focus();
  }, []);

  return (
    <section
      ref={refSection}
      tabIndex={-1}
      className="carte relecture-envoi"
      aria-label="Dernière étape : prévenir les services"
    >
      <h3 className="relecture-envoi-titre">
        Dernière étape : prévenir les services
      </h3>
      {concernes.length > 0 && (
        <p className="relecture-envoi-intro">
          Votre semaine est validée, mais le service n’a pas encore reçu vos
          changements. Relisez le récapitulatif puis envoyez-le.
        </p>
      )}

      {error !== null && (
        <p className="debit" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p className="muted">Chargement des brouillons…</p>}

      {data && concernes.length === 0 && (
        <p className="muted">
          Aucune modification à transmettre à un service pour cette semaine.
        </p>
      )}

      {concernes.map((brouillon) =>
        brouillon.routable ? (
          <BlocEnvoiEtablissement
            key={brouillon.etablissementId}
            foyerId={foyerId}
            semaineIso={semaineIso}
            jours={data?.jours ?? []}
            contrats={data?.contrats ?? []}
            brouillon={brouillon}
          />
        ) : (
          <CarteNonRoutable
            key={brouillon.etablissementId}
            foyerId={foyerId}
            brouillon={brouillon}
          />
        ),
      )}
    </section>
  );
}
