import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  AckPolicy,
  JSONCodec,
  nanos,
  type Consumer,
  type ConsumerMessages,
  type JsMsg,
} from 'nats';
import { NatsService } from './nats.service.js';
import {
  PROJECTION_PORT,
  sujetsDuStream,
  type ProjectionPort,
  type RaisonRejet,
} from './consumer.types.js';
import { DeadLetterService } from './dead-letter.service.js';
import {
  OPTIONS_CONSUMER,
  type OptionsConsumer,
} from './dead-letter.options.js';

const DELAI_BIND_MS = 5000;
const NAK_DELAI_MS = 2000;

/**
 * Nombre maximal de livraisons d'un même message avant abandon par JetStream.
 * Au-delà, un message génuinement inapplicable (ex. payload zod invalide, ou
 * orphelin dont l'événement amont n'arrivera jamais) cesse de boucler en NAK
 * toutes les ~2 s ; à la dernière livraison il part en dead-letter + `term()`.
 */
const MAX_LIVRAISONS = 10;

/**
 * Paliers d'attente (escalade) entre deux re-livraisons, indexés sur le numéro de
 * tentative. JetStream attend `backoff` en **nanosecondes** (`ConsumerConfig.backoff:
 * Nanos[]`, cf. `nats@2.x` `jsapi_types`), d'où la conversion via `nanos(ms)`. Le
 * premier palier (1 s) laisse à un événement amont en retard le temps d'être
 * projeté ; les suivants espacent les tentatives pour ne pas marteler la base.
 */
const BACKOFF_MS = [1_000, 5_000, 15_000, 30_000];
const BACKOFF_NANOS = BACKOFF_MS.map((ms) => nanos(ms));

const decodeurTexte = new TextDecoder();

/**
 * Consommateur **idempotent** JetStream **mutualisé** (doc 06 §8.4/§10.4). Une
 * seule classe pour les 3 services (Planification/Tarification/Notifications) :
 * seuls varient les abonnements et la table dead-letter, fournis via
 * `ConsumerModule.forRoot(...)`. Au démarrage (et tant que NATS n'est pas prêt),
 * tente de **lier les consommateurs durables** ; chaque message est projeté via le
 * `ProjectionPort` du service.
 *
 * Chaque durable est **borné à ce que la projection traite** (`filter_subjects`
 * dérivé de `ProjectionPort.typesGeres`, `AM-53`) : un événement qui ne concerne
 * pas ce service ne lui est pas livré, donc n'en laisse aucune copie. Avant cette
 * borne, il retombait dans le `default` du `switch` et son payload — revenus,
 * adresses e-mail — s'écrivait en clair dans `dead_letter` ; `TYPE_INCONNU` est
 * désormais un **incident** (contrat amont enrichi sans consommateur mis à jour),
 * pas le régime normal, et l'alerte `ConsumerRejetsDetectes` ne l'exclut plus.
 *
 * **Aucun message reçu ne disparaît en silence** : illisible (`PARSE_KO`), enveloppe
 * sans `type` (`ENVELOPPE_INVALIDE`), type non géré (`TYPE_INCONNU`) ou livraisons
 * épuisées (`MAX_LIVRAISONS`) laissent une ligne `dead_letter` + un compteur, puis
 * le message est acquitté (ou terminé) pour ne pas bloquer le stream. Une erreur
 * **transitoire** reste un **NAK** (re-livraison différée avec backoff). La
 * création des consommateurs durables est idempotente ; le binding est résilient
 * (réessai sans bloquer le boot) et l'arrêt ferme proprement les itérateurs.
 */
@Injectable()
export class JetStreamConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JetStreamConsumer.name);
  private readonly codec = JSONCodec();
  private readonly iterateurs = new Set<ConsumerMessages>();
  private bindTimer?: ReturnType<typeof setTimeout>;
  private arrete = false;
  private readonly lies = new Set<string>();

  constructor(
    private readonly nats: NatsService,
    @Inject(PROJECTION_PORT) private readonly projection: ProjectionPort,
    private readonly deadLetter: DeadLetterService,
    @Inject(OPTIONS_CONSUMER) private readonly options: OptionsConsumer,
  ) {}

  onApplicationBootstrap(): void {
    this.verifierAbonnements();
    void this.lierTous();
  }

  /**
   * Refuse de démarrer si un abonnement ne porte **aucun** sujet géré.
   *
   * C'est la garde qui rend `AM-53` tenable : un `filter_subjects` vide ne vaut
   * pas « rien » côté JetStream, il vaut **tout le stream** — précisément le
   * défaut qu'on ferme. Le cas n'arrive que par erreur de câblage (abonnement à
   * un stream dont la projection ne traite rien, ou faute de casse sur le nom du
   * stream), et il est déjà interdit statiquement par `pnpm abonnements` ; l'échec
   * au boot est le filet, pour que la faute ne puisse pas se rattraper en
   * silence à l'exécution.
   */
  private verifierAbonnements(): void {
    const vides = this.options.abonnements
      .filter(
        ({ stream }) =>
          sujetsDuStream(this.projection.typesGeres, stream).length === 0,
      )
      .map(({ durable, stream }) => `${durable}@${stream}`);
    if (vides.length > 0) {
      throw new Error(
        `Abonnement sans sujet géré : ${vides.join(', ')} — un filtre vide vaudrait « tout le stream » (AM-53).`,
      );
    }
  }

  /** Tente de lier les consommateurs non encore liés ; reprogramme si besoin. */
  private async lierTous(): Promise<void> {
    if (this.arrete) {
      return;
    }
    const js = this.nats.getJetStream();
    const connexion = this.nats.getConnection();
    if (!js || !connexion) {
      this.planifierReessai();
      return;
    }
    for (const { stream, durable } of this.options.abonnements) {
      if (this.lies.has(durable)) {
        continue;
      }
      try {
        await this.lierConsommateur(stream, durable);
        this.lies.add(durable);
      } catch (erreur) {
        this.logger.warn(
          `Liaison ${durable}@${stream} impossible (${(erreur as Error).message}) — réessai`,
        );
      }
    }
    if (this.lies.size < this.options.abonnements.length) {
      this.planifierReessai();
    }
  }

  private planifierReessai(): void {
    if (this.arrete) {
      return;
    }
    this.bindTimer = setTimeout(() => void this.lierTous(), DELAI_BIND_MS);
  }

  /** Crée (idempotent) le consommateur durable et lance la boucle de consommation. */
  private async lierConsommateur(
    stream: string,
    durable: string,
  ): Promise<void> {
    const connexion = this.nats.getConnection();
    const js = this.nats.getJetStream();
    if (!connexion || !js) {
      throw new Error('NATS non connecté');
    }
    const jsm = await connexion.jetstreamManager();
    // Champs **modifiables** d'un durable déjà en place (`ConsumerUpdateConfig`) :
    // `filter_subjects` en fait partie depuis NATS 2.10 (image `nats:2.10-alpine`).
    // `max_deliver`/`backoff` bornent les re-livraisons d'un message génuinement
    // inapplicable (anti-livelock).
    const modifiables = {
      max_deliver: MAX_LIVRAISONS,
      backoff: BACKOFF_NANOS,
      filter_subjects: [...sujetsDuStream(this.projection.typesGeres, stream)],
    };
    try {
      // `add` est idempotent côté serveur tant que la config demandée est
      // identique : un consommateur déjà présent est renvoyé tel quel.
      await jsm.consumers.add(stream, {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        ...modifiables,
      });
    } catch {
      // Consommateur déjà présent avec une **autre** config — le cas de tout
      // durable créé avant `AM-53`, qui n'a aucun filtre. L'ancien `catch` muet le
      // réutilisait tel quel : le filtre n'aurait jamais été posé en production et
      // le correctif aurait été un no-op invisible, vert en CI (où les durables
      // naissent avec le bon filtre) et sans effet sur la seule base qui accumule.
      // On met donc à jour, et un échec ici remonte au réessai de `lierTous`
      // plutôt que de se perdre.
      await jsm.consumers.update(stream, durable, modifiables);
    }
    const consommateur: Consumer = await js.consumers.get(stream, durable);
    const messages = await consommateur.consume();
    this.iterateurs.add(messages);
    void this.boucle(stream, messages);
    this.logger.log(`Consommateur durable lié : ${durable}@${stream}`);
  }

  /** Boucle de consommation d'un stream : projette puis ACK/NAK/dead-letter. */
  private async boucle(
    stream: string,
    messages: ConsumerMessages,
  ): Promise<void> {
    try {
      for await (const message of messages) {
        await this.traiterMessage(stream, message);
      }
    } catch (erreur) {
      if (!this.arrete) {
        this.logger.warn(
          `Boucle ${stream} interrompue (${(erreur as Error).message})`,
        );
      }
    }
  }

  private async traiterMessage(stream: string, message: JsMsg): Promise<void> {
    let donnees: unknown;
    try {
      donnees = this.codec.decode(message.data);
    } catch (erreur) {
      // Message illisible : trace durable puis ACK (ne pas bloquer le stream).
      await this.deadLetterEtAck(message, stream, 'PARSE_KO', null, erreur);
      return;
    }
    const resultat = await this.projection.traiter(stream, donnees);
    const envelopeId = this.extraireEnvelopeId(donnees);
    switch (resultat) {
      case 'TRAITE':
        message.ack();
        return;
      case 'IGNORE_ENVELOPPE_INVALIDE':
        await this.deadLetterEtAck(
          message,
          stream,
          'ENVELOPPE_INVALIDE',
          envelopeId,
        );
        return;
      case 'IGNORE_TYPE_INCONNU':
        await this.deadLetterEtAck(message, stream, 'TYPE_INCONNU', envelopeId);
        return;
      case 'ECHEC_TRANSITOIRE':
        await this.gererEchecTransitoire(message, stream, envelopeId);
        return;
    }
  }

  /**
   * Erreur transitoire : re-livraison (NAK) tant que les livraisons ne sont pas
   * épuisées ; à la **dernière** livraison autorisée (`MAX_LIVRAISONS`), on trace
   * en dead-letter et on **termine** le message (`term()`) plutôt que de le laisser
   * disparaître silencieusement quand JetStream cesse de le livrer.
   */
  private async gererEchecTransitoire(
    message: JsMsg,
    stream: string,
    envelopeId: string | null,
  ): Promise<void> {
    // `deliveryCount` = nombre de livraisons (1 à la première). La dernière
    // livraison autorisée vaut `MAX_LIVRAISONS` : au-delà, JetStream n'en fait plus.
    if (message.info.deliveryCount >= MAX_LIVRAISONS) {
      await this.deadLetter.enregistrer({
        envelopeId,
        stream,
        sujet: message.subject,
        raison: 'MAX_LIVRAISONS',
        payload: decodeurTexte.decode(message.data),
        erreur: null,
        livraisons: message.info.deliveryCount,
      });
      message.term();
      return;
    }
    message.nak(NAK_DELAI_MS);
  }

  /** Trace en dead-letter puis acquitte le message (rejets définitifs). */
  private async deadLetterEtAck(
    message: JsMsg,
    stream: string,
    raison: RaisonRejet,
    envelopeId: string | null,
    erreur?: unknown,
  ): Promise<void> {
    await this.deadLetter.enregistrer({
      envelopeId,
      stream,
      sujet: message.subject,
      raison,
      payload: decodeurTexte.decode(message.data),
      erreur: erreur === undefined ? null : (erreur as Error).message,
      livraisons: message.info.deliveryCount,
    });
    message.ack();
  }

  /** Lit l'`id` d'enveloppe d'un message décodé (null si absent/non conforme). */
  private extraireEnvelopeId(donnees: unknown): string | null {
    if (
      typeof donnees === 'object' &&
      donnees !== null &&
      'id' in donnees &&
      typeof donnees.id === 'string'
    ) {
      return (donnees as { id: string }).id;
    }
    return null;
  }

  async onApplicationShutdown(): Promise<void> {
    this.arrete = true;
    if (this.bindTimer) {
      clearTimeout(this.bindTimer);
    }
    for (const iterateur of this.iterateurs) {
      try {
        await iterateur.close();
      } catch {
        // arrêt best-effort
      }
    }
  }
}
