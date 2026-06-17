export const OPTIONS_NATS = Symbol('OPTIONS_NATS');

/** Points de variance de la connexion NATS, fournis par chaque service. */
export interface OptionsNats {
  /** Nom de connexion NATS (ex. `svc-foyer`). */
  service: string;
  /** Stream JetStream possédé par le contexte (ex. `FOYER`). */
  stream: string;
  /** Préfixe de sujet couvert par le stream (ex. `foyer.>`). */
  sujet: string;
  /** URL du broker, résolue paresseusement (l'environnement est lu à l'instanciation). */
  url: () => string;
}
