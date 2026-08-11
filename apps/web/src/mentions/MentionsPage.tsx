import { Link } from 'react-router-dom';
import { useTitrePage } from '../hooks/useTitrePage';

/** Registre des traitements versionné dans le dépôt public (doc 37). */
const URL_REGISTRE =
  'https://github.com/EdouardZemb/creche-planner/blob/main/docs/37-registre-des-traitements.md';

/**
 * Page **publique** d'information sur les données (route hors `GardeFoyer`, comme
 * `DesabonnementPage`) : c'est l'un des deux canaux prévus par le § 5 de la doc 37
 * — l'autre étant le pied des courriels sortants, seul canal qui atteigne l'agent
 * d'établissement, lequel n'ouvre jamais l'application.
 *
 * Elle est **volontairement courte** et renvoie au registre pour le détail : les
 * deux textes doivent bouger ensemble, et aucune porte de CI ne le garantit
 * (limite connue, écrite dans la doc 37 elle-même).
 *
 * ⚠️ Cadrage éditorial, tranché par l'ADR-0007 : l'exemption domestique de
 * l'article 2(2)(c) est **assumée**, le dépôt ne revendique **aucune conformité**.
 * Ce texte ne contient donc aucune formule réglementaire, et surtout il ne promet
 * que ce qui est OUTILLÉ aujourd'hui — le seul droit outillé est l'opposition
 * (désabonnement + préférences, ADR-0006).
 *
 * La symétrie compte autant : ne rien promettre de faux, mais ne rien nier de
 * vrai non plus. Il n'existe ni suppression de la famille entière ni export
 * (doc 37 § 4) — la page le dit ; en revanche l'application supprime bel et bien
 * à l'unité (`retirerEnfant` est un hard delete en cascade, `supprimerContrat`
 * et `supprimerEtablissement` de même), et prétendre l'inverse contredirait la
 * phrase qui invite l'établissement à demander le retrait de ses coordonnées.
 */
export function MentionsPage() {
  useTitrePage('Informations sur vos données');

  return (
    <div>
      <h1>Informations sur vos données</h1>

      <section className="carte page-etroite">
        <p className="profil-intro">
          Crèche Planner est un outil familial, développé et hébergé par un
          parent pour organiser la garde des enfants d’un seul foyer : contrats
          d’accueil, plannings, coût du mois, et l’envoi du récapitulatif de la
          semaine au service qui accueille les enfants.
        </p>

        <h2>Ce qui est enregistré</h2>
        <ul>
          <li>
            <strong>Parents</strong> : prénom, nom, adresse e-mail (elle sert
            aussi à vous reconnaître à la connexion), ressources mensuelles,
            revenu fiscal de référence et nombre de parts — ce sont eux qui
            déterminent le tarif.
          </li>
          <li>
            <strong>Enfants</strong> : prénom, date de naissance, mode de garde,
            présences et absences.
          </li>
          <li>
            <strong>Établissements</strong> : nom, adresse, téléphone, e-mail de
            service et personne à contacter.
          </li>
          <li>
            <strong>Messages envoyés</strong> : leur sujet, leur contenu et
            leurs destinataires sont gardés tels qu’ils sont partis, pour
            pouvoir dire ce qui a réellement été adressé.
          </li>
        </ul>

        <h2>Combien de temps</h2>
        <p>
          Les durées que l’on se fixe : <strong>trois ans</strong> pour les
          données de foyer et de garde (le temps pendant lequel un tarif peut
          encore être recalculé), <strong>treize mois</strong> pour les preuves
          d’envoi, <strong>douze mois</strong> pour la boîte de réception de
          l’application.
        </p>
        <p className="muted">
          Ce sont des objectifs, pas encore un mécanisme : aucune suppression
          automatique n’est en place à ce jour.
        </p>

        <h2>Par où passent ces données</h2>
        <ul>
          <li>
            L’<strong>acheminement des courriels</strong> : le service de
            messagerie qui les transporte voit le contenu des messages envoyés.
          </li>
          <li>
            Le <strong>tunnel d’accès</strong> qui expose l’application sur
            Internet et vérifie qui a le droit de l’ouvrir : le trafic y passe
            en clair.
          </li>
          <li>
            La <strong>copie des sauvegardes hors du serveur</strong> : elle est
            chiffrée avant d’être envoyée, l’espace de dépôt ne peut pas la
            lire.
          </li>
        </ul>

        <h2>Ce que vous pouvez faire aujourd’hui</h2>
        <ul>
          <li>
            Ne plus recevoir les rappels par e-mail : le lien de désabonnement
            au bas de chaque message suffit, en un clic.
          </li>
          <li>
            Choisir comment chaque rappel vous parvient (e-mail, application)
            depuis <Link to="/mon-profil">Mon profil</Link>.
          </li>
        </ul>

        <h2>Effacer ou récupérer vos données</h2>
        <p>
          L’application sait déjà supprimer un enfant, un contrat ou une crèche
          / école, et ces suppressions-là effacent réellement la donnée. Ce qui
          manque, c’est le geste d’ensemble : il n’y a{' '}
          <strong>ni suppression de la famille entière, ni export</strong>, donc
          rien ne permet aujourd’hui de tout effacer d’un coup ni de récupérer
          une copie de vos données. Retirer un parent, de même, le sort de la
          famille mais conserve son nom et son adresse e-mail. Les deux
          chantiers sont ouverts ; en attendant, la demande passe par la
          personne qui édite l’outil.
        </p>

        <h2>Vous recevez le récapitulatif d’une famille ?</h2>
        <p>
          Si vous arrivez ici depuis un courriel adressé à votre structure, vous
          n’avez aucun compte à créer : seules les coordonnées de service de
          votre établissement sont enregistrées, saisies par la famille — une
          réponse à ce courriel suffit pour en demander la correction ou le
          retrait.
        </p>

        <h2>Le détail</h2>
        <p>
          Quelles données vivent où, chez quels tiers elles transitent et ce qui
          manque encore : tout est écrit dans le{' '}
          <a href={URL_REGISTRE}>
            registre des traitements, des tiers et des durées de conservation
          </a>{' '}
          du dépôt public.
        </p>
      </section>
    </div>
  );
}
