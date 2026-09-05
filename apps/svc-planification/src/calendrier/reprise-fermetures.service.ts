import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { instant } from '@creche-planner/shared-kernel';
import { CLOCK, DRIZZLE, type Clock } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  calendrierException,
  contrat,
  type NouvelleCalendrierExceptionRow,
} from '../database/schema.js';

/**
 * **Fermetures crèche 2026 — copie GELÉE, à dessein.**
 *
 * Ces 18 dates sont aujourd'hui la source unique des jours non facturables, via
 * `jour_non_facturable` du Référentiel (`svc-referentiel/.../seed.service.ts`).
 * Le lot 4 fait du calendrier d'ouverture cette source unique (RM-31-04) : il faut
 * donc les faire exister ici, sans quoi le premier mois généré après le
 * déploiement facturerait des jours de fermeture.
 *
 * La constante est **dupliquée** plutôt qu'importée ou lue à chaud, et c'est un
 * choix, pas une facilité : la base du Référentiel n'est pas joignable depuis ce
 * service, un appel HTTP au démarrage serait un point de panne de plus sur le
 * chemin de boot, et surtout une reprise doit figer ce qu'elle reprend. Si le
 * Référentiel change ses dates demain, cette reprise-ci ne doit pas changer d'avis
 * rétroactivement.
 *
 * Sept de ces dates sont des **jours fériés** (01/01, 06/04, 01/05, 08/05, 14/05,
 * 25/05, 14/07) : le domaine les recalcule de toute façon par `joursFeries`, elles
 * sont donc redondantes — mais les poser en exception ne change aucun résultat, et
 * les retirer de la liste demanderait de rejouer le calcul des fériés ici. On
 * reprend la liste telle qu'elle est.
 */
const FERMETURES_2026: readonly string[] = [
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-01-04',
  '2026-04-06',
  '2026-05-01',
  '2026-05-08',
  '2026-05-14',
  '2026-05-15',
  '2026-05-16',
  '2026-05-17',
  '2026-05-25',
  '2026-07-14',
  '2026-07-27',
  '2026-07-28',
  '2026-07-29',
  '2026-07-30',
  '2026-07-31',
];

/** Libellé porté par les exceptions créées — repris tel quel du Référentiel. */
const LIBELLE = 'Fermeture crèche 2026';

/**
 * Reprise de données du lot 4 : matérialise les fermetures crèche 2026 comme
 * **exceptions de calendrier**, sur les seuls établissements qui accueillent
 * réellement une crèche.
 *
 * **Pourquoi au boot et non en SQL** : le récapitulatif ops du plan attend un
 * comptage exact dans le journal applicatif, qu'une migration SQL ne sait pas
 * produire (un `RAISE NOTICE` part dans le journal Postgres, pas dans celui du
 * service). Le geste reste celui d'une migration de données : idempotent, joué au
 * démarrage, sans effet au second passage.
 *
 * **Scoping — établissements portant au moins un contrat `CRECHE_PSU`.** Surtout
 * pas le `jsonb` `types` de l'établissement : il est informatif, vaut `'[]'` par
 * défaut, et personne ne le remplit. Et surtout pas « tous les établissements » :
 * ces 18 dates sont les fermetures d'une crèche réelle, les poser sur les crèches
 * de tous les foyers d'un staging multi-foyers serait une fuite de données de
 * référence dans des dossiers qui ne les ont jamais connues.
 *
 * **Idempotence** : aucune exception n'est créée sur un couple
 * (établissement, jour) qui en porte déjà une **ouverte** — ce qui couvre à la
 * fois le second boot et le cas où le parent a déjà saisi sa propre fermeture ce
 * jour-là. Sa saisie gagne, la reprise ne l'écrase pas.
 */
@Injectable()
export class RepriseFermeturesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RepriseFermeturesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const creees = await this.reprendre();
      this.logger.log(
        `exceptions crèche créées depuis jour_non_facturable : ${String(creees)}`,
      );
    } catch (erreur) {
      // Une reprise qui échoue ne doit pas empêcher le service de démarrer : les
      // lectures de prestations restent correctes pour tout ce qui n'est pas une
      // fermeture crèche. Mais elle ne doit pas non plus passer inaperçue — c'est
      // la différence entre un écart connu et un montant faux sans témoin.
      this.logger.error(
        `reprise des fermetures crèche 2026 en échec : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }

  /** Crée les exceptions manquantes et rend leur nombre. */
  async reprendre(): Promise<number> {
    const crecheries = await this.db
      .selectDistinct({ etablissementId: contrat.etablissementId })
      .from(contrat)
      .where(eq(contrat.mode, 'CRECHE_PSU'));
    const etablissements = crecheries.map((ligne) => ligne.etablissementId);
    if (etablissements.length === 0) {
      return 0;
    }

    // Une seule lecture pour tous les couples : la reprise tourne au démarrage,
    // elle n'a aucune raison d'ouvrir 18 × N requêtes.
    const dejaLa = await this.db
      .select({
        etablissementId: calendrierException.etablissementId,
        jour: calendrierException.jour,
      })
      .from(calendrierException)
      .where(
        and(
          inArray(calendrierException.etablissementId, etablissements),
          inArray(calendrierException.jour, [...FERMETURES_2026]),
          isNull(calendrierException.connuJusqua),
        ),
      );
    const couvert = new Set(
      dejaLa.map((ligne) => `${ligne.etablissementId}|${ligne.jour}`),
    );

    const connuDepuis = new Date(
      instant(this.clock.maintenant().toISOString()),
    );
    const aCreer: NouvelleCalendrierExceptionRow[] = [];
    for (const etablissementId of etablissements) {
      for (const jour of FERMETURES_2026) {
        if (couvert.has(`${etablissementId}|${jour}`)) {
          continue;
        }
        aCreer.push({
          etablissementId,
          jour,
          type: 'FERMETURE',
          libelle: LIBELLE,
          // `null` = tous les services. Sur un établissement crèche, fermer
          // « tout » et fermer `CRECHE_PSU` reviennent au même — et laisser la
          // colonne nulle évite d'inventer une liste de services que la reprise
          // n'a aucun moyen de connaître.
          services: null,
          connuDepuis,
        });
      }
    }
    if (aCreer.length === 0) {
      return 0;
    }
    await this.db.insert(calendrierException).values(aCreer);
    return aCreer.length;
  }
}
