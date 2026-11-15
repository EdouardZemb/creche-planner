#!/usr/bin/env node
// @ts-check
/**
 * Porte du **durcissement des conteneurs** (`AM-48`, lot 8 des standards).
 *
 * ## Pourquoi ce script existe
 *
 * Avant le lot 8, les quatre `docker-compose*.yml` ne portaient **aucune** des
 * trois options du CIS Docker Benchmark que Docker n'applique pas de lui-même :
 * `no-new-privileges` (§5.25), `cap_drop: [ALL]` (§5.3) et `read_only` (§5.12).
 * Le lot les a posées sur les 29 services des trois piles.
 *
 * Rien, ensuite, n'empêche un service **neuf** d'arriver sans elles : un compose
 * n'a pas de schéma qui exige une posture, et un conteneur trop permissif
 * démarre parfaitement — c'est même tout son problème. La dérive serait donc
 * silencieuse, et elle le serait d'autant plus que le durcissement vit dans une
 * **ancre YAML** partagée : oublier `<<: *durcissement` sur un service ne casse
 * rien, ne se voit pas à la relecture d'un diff, et ne rougit nulle part.
 *
 * ## Ce que la porte garantit
 *
 * Pour **chacune des trois piles** — dev/CI (`base` + `override`), production
 * (`base` + `server`), staging (`base` + `staging`) — et pour **chaque** service
 * qu'elle lève :
 *
 * 1. `security_opt` contient `no-new-privileges:true` ;
 * 2. `cap_drop` contient `ALL`, et le service n'est PAS en `privileged: true`
 *    (CIS 5.4) — le mode privilégié rend tout ce que le `cap_drop` écrit juste
 *    au-dessus venait de retirer, sans qu'aucune ligne de durcissement ne bouge ;
 * 2bis. aucune entrée de `security_opt` ne **défait** un profil
 *    (`seccomp:unconfined`, `apparmor:unconfined`, `label:disable`,
 *    `no-new-privileges:false`) : Compose CONCATÈNE cette séquence, donc un
 *    override peut désarmer le conteneur **sans** retirer la bonne entrée ;
 * 3. toute capacité **reprise** (`cap_add`) est déclarée ci-dessous avec son
 *    motif, service par service — reprendre `NET_RAW` « pour voir » ne passe pas ;
 * 4. la racine est en lecture seule (`read_only: true`), sauf exemption déclarée
 *    ci-dessous avec son motif.
 *
 * Et, dans l'autre sens (une entrée de registre qui devient fausse est un
 * mensonge, pas un reste inoffensif — leçon du lot 5) :
 *
 * 5. une exemption qui nomme un service **inexistant**, ou un service désormais
 *    en lecture seule, est signalée ;
 * 6. une capacité déclarée que plus aucun compose ne reprend est signalée.
 *
 * Et, depuis `AM-94` (2026-08-17), sur l'**exposition réseau** des deux piles
 * hébergées — production et staging, celles qui tournent sur une machine
 * joignable, LAN et tailnet compris :
 *
 * 7. tout port publié y est borné à la **loopback** (`127.0.0.1:` / `[::1]:`).
 *    Omettre l'IP hôte n'est pas neutre : Compose publie alors sur `0.0.0.0`
 *    ET `::`, donc au LAN et au tailnet — que le pare-feu de l'hôte ne filtre
 *    pas. Or ces piles n'ont **aucun bord authentifiant à elles** : le seul est
 *    le JWT Cloudflare Access, qu'un accès direct ne traverse pas. C'est
 *    exactement ce qui a rendu le dossier des foyers lisible sans identité
 *    depuis le tailnet (mesuré le 2026-08-17). La pile dev/CI est HORS de cette
 *    règle : elle ne tourne que sur un poste, et publie en clair par dessein ;
 * 8. chaque pile publie **au moins un** port — sans quoi la règle 7 serait
 *    verte par vacuité, et la pile n'aurait plus de sonde de déploiement ;
 * 9. la production publie un port loopback sur `web` ou `api-gateway` : la
 *    porte 3 de `scripts/deploy.mjs` (santé/seed/perf) **en dérive** son URL.
 *    Retirer ce port ne casse rien en CI, et fait échouer le déploiement
 *    suivant — le repli (`SERVER_ORIGIN`, l'origine LAN) n'existe plus.
 *
 * Et, depuis `LE-105` (2026-11-15), sur les **deux corollaires** de la racine
 * immuable, dans les trois piles :
 *
 * 10. chaque service borne son journal Docker : pilote `json-file` et
 *     `max-size` déclarés. Sans borne, le journal ne repart à zéro qu'à la
 *     recréation du conteneur, et un conteneur dont rien ne change n'est jamais
 *     recréé : celui de loki a atteint 125 Go en trois mois sur le serveur ;
 * 11. chaque service à racine en lecture seule a un `/tmp` inscriptible (un
 *     `tmpfs`). Un programme tient `/tmp` pour acquis, et l'écriture refusée
 *     peut vivre dans un chemin que ni le démarrage ni le healthcheck
 *     n'exercent : la rétention de loki n'a tourné qu'à partir du huitième jour,
 *     et n'a jamais réussi. Un service qui écrit son propre `tmpfs:` remplace
 *     celui de l'ancre (clé de fusion YAML) : c'est le cas que la règle attrape.
 *
 * ## Ce que la porte NE garantit **pas**
 *
 *  - Sur les règles 10 et 11, elle ne juge que le texte : un conteneur en
 *    marche garde le journal et les montages de sa création, jusqu'à sa
 *    recréation. Elle ne lit ni le `daemon.json` du serveur ni la taille réelle
 *    des journaux, et ne prouve pas qu'un `/tmp` suffise : une image peut
 *    écrire ailleurs (`/var/run`, `$HOME`). Le `tmpfs` n'a pas de taille : sa
 *    mémoire est comptée dans celle du conteneur, que seule la production
 *    plafonne (`mem_limit`). Un `logging:` écrit en ligne (`{driver: …}`) n'est
 *    pas lu, et la règle 10 le refuse : écrire la forme en bloc.
 *  - Elle ne prouve pas que la pile **démarre** ainsi durcie : seuls les jobs
 *    `e2e-stack` le montre (smokes compris), et il ne lève que la pile
 *    dev/CI. Un service que seule la prod porte (`caddy`, `cloudflared`) n'est
 *    éprouvé que sur le poste, à la main (`EM-14`).
 *  - Elle ne prouve pas qu'une pile durcie **redémarre** : la distinction est
 *    tout sauf théorique — le jeu de capacités minimal de Postgres passe le
 *    premier boot (volume vide) et meurt au second, quand le répertoire de
 *    données existe en `0700` pour l'uid 70 (`LE-53`). Aucune CI ne lève deux
 *    fois la même pile.
 *  - Elle lit le **texte** des composes (ancres YAML résolues à la main, zéro
 *    dépendance), pas la spécification fusionnée que rend `docker compose
 *    config` : ni `env_file:`, ni substitution `${VAR}`, ni profils (`EM-12`).
 *  - Elle ne dit rien du `Dockerfile` : l'utilisateur non-root de l'image, les
 *    paquets installés et les secrets de build sont hors périmètre.
 *  - Elle ne juge pas si un motif est **bon**. « L'état vit dans la couche du
 *    conteneur » reste vrai le jour où un volume nommé le rendrait faux.
 *  - Elle ne voit pas où atterrit une écriture légitime, et une racine en
 *    lecture seule ne prouve donc RIEN sur la durabilité : l'image amont peut
 *    déclarer un `VOLUME`, auquel cas Docker pose un volume **anonyme** qui
 *    rend le service inscriptible sans qu'aucune ligne de compose le dise.
 *    Mesuré (`AM-83`) : cet anonyme survit à `up -d --force-recreate`, et se
 *    perd — en laissant un orphelin — au premier `down`/`up`. Un état qui doit
 *    survivre s'écrit en volume **nommé**, ce qu'aucune porte ne sait exiger.
 *  - Sur l'exposition (règles 7-9), elle ne juge pas la commande RÉELLEMENT
 *    tapée. Le clone du serveur porte aussi `docker-compose.override.yml`, que
 *    Compose charge **tout seul** quand aucun `-f` n'est passé : un
 *    `docker compose up -d` nu y republierait bases, observabilité, gateway et
 *    `web` sur `0.0.0.0` — soit pire qu'`AM-94`, et sans qu'aucune ligne de la
 *    pile de production ait changé. `deploy.mjs` nomme toujours ses deux
 *    fichiers ; le geste manuel n'est gardé par rien (`AM-97`).
 *  - Elle ne juge que le **texte des composes du dépôt**. Elle ne mesure RIEN sur la machine : un conteneur déjà en marche
 *    garde les bindings de sa création jusqu'au prochain `up -d`, un
 *    `docker run -p` à la main lui échappe, et une autre pile du serveur
 *    (Paperless, médias…) est hors périmètre. La sonde côté machine est
 *    `scripts/verify-exposure.sh`, à lancer depuis un AUTRE poste du LAN.
 *  - Elle ne dit rien du **pare-feu** ni des ACL Tailscale, ni de ce que
 *    Cloudflare Access authentifie en amont du tunnel : « loopback » ne veut
 *    pas dire « authentifié », seulement « pas joignable par le réseau ». Ce que
 *    le chemin public authentifie vit dans le tableau de bord Zero Trust, hors
 *    dépôt — aucune porte de ce dépôt ne peut le vérifier.
 *
 * ## Usage
 *   pnpm conteneurs              # vérifie (exit 1 si un constat)
 *   pnpm conteneurs --autotest   # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : un balayage qui ne trouve rien ÉCHOUE.
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture (règle CodeQL `js/file-system-race`, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

const BASE = 'docker-compose.yml';

/**
 * Les trois piles réellement levées, chacune avec les composes que Compose
 * fusionne, **dans l'ordre**. L'override de développement est chargé
 * automatiquement quand aucun `-f` n'est passé (dev local, `e2e-stack`) ; la production et le staging nomment le leur explicitement.
 */
const PILES = [
  { nom: 'dev/CI', composes: [BASE, 'docker-compose.override.yml'] },
  {
    nom: 'production',
    composes: [BASE, 'docker-compose.server.yml'],
    expositionLoopback: true,
    sondeDeploiement: ['web', 'api-gateway'],
  },
  {
    nom: 'staging',
    composes: [BASE, 'docker-compose.staging.yml'],
    expositionLoopback: true,
  },
];

/**
 * Capacités **reprises** après `cap_drop: [ALL]`, par service, avec leur motif.
 * Une capacité rendue est une décision : elle rouvre exactement ce que le
 * `cap_drop` venait de fermer.
 */
const CAPACITES_REPRISES = [
  {
    services: [
      'postgres-referentiel',
      'postgres-foyer',
      'postgres-planification',
      'postgres-tarification',
      'postgres-notifications',
    ],
    capacites: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID'],
    motif:
      "l'entrypoint de l'image postgres démarre root puis bascule sur l'uid 70 " +
      '(SETUID/SETGID). Au SECOND boot, le répertoire de données existe en 0700 ' +
      'pour cet uid : root doit le traverser (DAC_OVERRIDE), en reprendre les ' +
      'droits (FOWNER) et la propriété (CHOWN). Sans DAC_OVERRIDE ni FOWNER, le ' +
      'conteneur démarre une fois puis meurt à tous les suivants (LE-53).',
  },
  {
    services: ['caddy'],
    capacites: ['NET_BIND_SERVICE'],
    motif:
      'Caddy est le seul processus de la pile à se lier à des ports privilégiés ' +
      '(80 et 443 dans le conteneur ; publiés sur la LOOPBACK de l’hôte seulement ' +
      'depuis `AM-94`).',
  },
];

/**
 * Services dont la racine reste **inscriptible**, avec leur motif.
 *
 * `AM-83` (2026-08-15) a fait tomber les trois exemptions du lot 8 — magasin
 * JetStream, base TSDB, silences d'Alertmanager — qui tenaient toutes au même
 * manque : un état sans volume nommé. Le volume posé, la racine immuable
 * devient possible… sauf pour `alertmanager`, et pour une raison qui n'a rien à
 * voir avec la durabilité : il reçoit un **secret Compose**.
 *
 * @type {{ service: string, motif: string }[]}
 */
const RACINES_INSCRIPTIBLES = [
  {
    service: 'alertmanager',
    motif:
      'reçoit en production un secret Compose de source `environment:` (mot de ' +
      'passe SMTP). Compose matérialise CE type de secret par une COPIE dans le ' +
      'conteneur, et le démon refuse la copie sur une racine en lecture seule ' +
      '(« container rootfs is marked read-only ») : le conteneur est créé, jamais ' +
      'démarré, et `up -d --wait` échoue. Constaté en production le 2026-08-15, ' +
      'reproduit à la main. Un secret de source `file:` serait monté, pas copié — ' +
      'mais il vivrait alors en clair sur le disque, ce que sops+age évite.',
  },
];

/**
 * Services qui reçoivent un secret Compose de source `environment:`, quelle que
 * soit la pile. Dérivé des composes, jamais écrit à la main : c'est le couple
 * (service qui déclare `secrets:`) × (secret de premier niveau dont la source
 * est `environment:`).
 *
 * @param {Record<string, string>} contenus
 * @returns {Set<string>}
 */
function servicesASecretCopie(contenus) {
  /** @type {Set<string>} */
  const services = new Set();
  for (const [, texte] of Object.entries(contenus)) {
    // Secrets de premier niveau dont la source est `environment:`.
    const copies = new Set();
    const blocSecrets = /\nsecrets:\r?\n([\s\S]*?)(?=\n[a-zA-Z]|$)/.exec(texte);
    if (blocSecrets !== null) {
      let nomCourant = null;
      for (const ligne of blocSecrets[1].split(/\r?\n/)) {
        const nom = /^ {2}([a-zA-Z0-9_.-]+):\s*$/.exec(ligne);
        if (nom !== null) {
          nomCourant = nom[1];
          continue;
        }
        if (nomCourant !== null && /^ {4}environment:/.test(ligne)) {
          copies.add(nomCourant);
        }
      }
    }
    if (copies.size === 0) continue;
    // Services qui les consomment.
    for (const [nom, bloc] of analyser(texte).services) {
      for (const secret of bloc.secrets) {
        if (copies.has(secret)) services.add(nom);
      }
    }
  }
  return services;
}

/** @param {string} relatif */
function lire(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch (erreur) {
    throw new Error(
      `${relatif} illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
}

/**
 * @typedef {object} Bloc
 * @property {string[]} securityOpt
 * @property {string[]} capDrop
 * @property {string[]} capAdd
 * @property {string[]} secrets  noms des secrets Compose consommés
 * @property {string[]} ports  mappings publiés, tels qu'écrits (`'127.0.0.1:80:80'`)
 * @property {string[]} tmpfs  montages tmpfs, tels qu'écrits (`/tmp`, `/tmp:size=64m`)
 * @property {Journal | null} journal  bloc `logging:` déclaré, `null` s'il ne l'est pas
 * @property {boolean | null} readOnly
 * @property {boolean | null} privileged
 * @property {string[]} ancres  ancres reprises par `<<: *nom`
 */

/**
 * @typedef {object} Journal
 * @property {string | null} pilote  `driver:`
 * @property {string | null} tailleMax  `options.max-size`
 * @property {string | null} fichiersMax  `options.max-file`
 */

/** @returns {Bloc} */
function blocVide() {
  return {
    securityOpt: [],
    capDrop: [],
    capAdd: [],
    secrets: [],
    ports: [],
    tmpfs: [],
    journal: null,
    readOnly: null,
    privileged: null,
    ancres: [],
  };
}

/** @returns {Journal} */
function journalVide() {
  return { pilote: null, tailleMax: null, fichiersMax: null };
}

/**
 * Fusion de deux blocs `logging:` **entre fichiers** Compose : un pilote
 * différent remplace tout (les options de l'ancien n'ont plus de sens), un même
 * pilote — ou un pilote tu — fusionne les options, la dernière l'emportant.
 *
 * @param {Journal | null} avant
 * @param {Journal | null} apres
 * @returns {Journal | null}
 */
function fusionnerJournal(avant, apres) {
  if (apres === null) return avant;
  if (
    avant === null ||
    (apres.pilote !== null && apres.pilote !== avant.pilote)
  ) {
    return { ...apres };
  }
  return {
    pilote: avant.pilote,
    tailleMax: apres.tailleMax ?? avant.tailleMax,
    fichiersMax: apres.fichiersMax ?? avant.fichiersMax,
  };
}

/**
 * Le journal est-il **borné** ? Pilote `json-file` et `max-size` lisible
 * (`10m`, `512k`, `1g`) ; `max-file`, s'il est écrit, est un entier positif.
 * Sans `max-file`, `json-file` garde un seul fichier : borné aussi.
 *
 * @param {Journal | null} journal
 */
function journalBorne(journal) {
  if (journal === null) return false;
  if (journal.pilote !== 'json-file') return false;
  if (journal.tailleMax === null || !/^\d+[kmg]$/.test(journal.tailleMax)) {
    return false;
  }
  return journal.fichiersMax === null || /^[1-9]\d*$/.test(journal.fichiersMax);
}

/**
 * Le service a-t-il un `/tmp` inscriptible ? Un montage s'écrit `chemin` ou
 * `chemin:options` ; seul le chemin compte.
 *
 * @param {string[]} tmpfs
 */
function aUnTmpInscriptible(tmpfs) {
  return tmpfs.some((montage) => montage.split(':')[0].trim() === '/tmp');
}

/** @param {string} valeur */
function sansGuillemets(valeur) {
  return valeur.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Un mapping publié est-il **borné à la loopback** ?
 *
 * Compose publie sur `0.0.0.0` (+ `::`) dès que l'IP hôte est omise : la forme
 * courte `'8443:443'` ouvre le port à TOUTES les interfaces — LAN **et**
 * `tailscale0`, que le pare-feu de l'hôte ne filtre pas (`AM-94`). Seul un
 * préfixe d'IP loopback explicite borne la publication à la machine.
 *
 * @param {string} mapping mapping tel qu'écrit dans le compose
 */
function borneALaLoopback(mapping) {
  return /^(127\.0\.0\.1|\[::1\]):/.test(mapping.trim());
}

/**
 * Entrées de `security_opt` qui **défont** une protection au lieu d'en poser
 * une. Compose CONCATÈNE cette séquence : un override peut donc ajouter
 * `seccomp:unconfined` **sans retirer** `no-new-privileges:true`, et une porte
 * qui se contente de chercher la bonne entrée reste verte sur un conteneur
 * désarmé.
 *
 * @param {string} entree
 */
function affaiblit(entree) {
  const valeur = entree.toLowerCase();
  return (
    valeur.endsWith(':unconfined') ||
    valeur === 'label:disable' ||
    valeur === 'no-new-privileges:false'
  );
}

/**
 * Valeurs d'une séquence YAML écrite soit en bloc (`- ALL`), soit en ligne
 * (`['ALL']`). Les guillemets et l'espace sont retirés ; le reste est rendu tel
 * quel, y compris un `no-new-privileges:true` qui porte un `:`.
 *
 * @param {string} enLigne
 * @returns {string[]}
 */
function sequenceEnLigne(enLigne) {
  const dedans = /^\[(.*)\]$/.exec(enLigne.trim());
  if (dedans === null) return [];
  return dedans[1]
    .split(',')
    .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter((v) => v.length > 0);
}

/**
 * Analyse un compose : les ancres de premier niveau (`x-nom: &ancre`) et les
 * services, avec pour chacun la posture déclarée.
 *
 * Analyse ligne à ligne plutôt qu'un parseur YAML (zéro dépendance, cf. les
 * autres portes du dépôt) : on ne cherche qu'une poignée de clés, à une
 * indentation connue, et les `<<: *ancre` qui les héritent. Seul `logging:` a
 * des sous-clés lues (`driver`, `options.max-size`, `options.max-file`), et
 * seulement en forme bloc.
 *
 * @param {string} contenu
 * @returns {{ ancres: Map<string, Bloc>, services: Map<string, Bloc> }}
 */
function analyser(contenu) {
  /** @type {Map<string, Bloc>} */
  const ancres = new Map();
  /** @type {Map<string, Bloc>} */
  const services = new Map();

  let courant = /** @type {Bloc | null} */ (null);
  let dansServices = false;
  /** @type {'securityOpt' | 'capDrop' | 'capAdd' | 'secrets' | 'ports' | 'tmpfs' | null} */
  let sequence = null;
  /** dans le bloc `logging:` du bloc courant */
  let dansJournal = false;
  /** indentation des clés du bloc courant (2 pour une ancre, 4 pour un service) */
  let indentation = 2;

  for (const ligne of contenu.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(ligne)) continue;

    const ancre = /^(x-[a-zA-Z0-9_-]+):\s*&([a-zA-Z0-9_-]+)\s*$/.exec(ligne);
    if (ancre !== null) {
      courant = blocVide();
      ancres.set(ancre[2], courant);
      dansServices = false;
      sequence = null;
      dansJournal = false;
      indentation = 2;
      continue;
    }

    if (/^services:\s*$/.test(ligne)) {
      dansServices = true;
      courant = null;
      sequence = null;
      dansJournal = false;
      continue;
    }

    if (/^[a-zA-Z]/.test(ligne)) {
      // toute autre clé de premier niveau (volumes:, secrets:, name:…)
      dansServices = false;
      courant = null;
      sequence = null;
      dansJournal = false;
      continue;
    }

    const service = /^ {2}([a-zA-Z0-9_.-]+):\s*$/.exec(ligne);
    if (service !== null && dansServices) {
      courant = blocVide();
      services.set(service[1], courant);
      sequence = null;
      dansJournal = false;
      indentation = 4;
      continue;
    }

    if (courant === null) continue;

    if (dansJournal && courant.journal !== null) {
      const sousCle = new RegExp(
        `^ {${indentation + 2}}(driver|options):\\s*(.*)$`,
      ).exec(ligne);
      if (sousCle !== null) {
        if (sousCle[1] === 'driver') {
          courant.journal.pilote = sansGuillemets(sousCle[2]);
        }
        continue;
      }
      const option = new RegExp(
        `^ {${indentation + 4}}(max-size|max-file):\\s*(.*)$`,
      ).exec(ligne);
      if (option !== null) {
        if (option[1] === 'max-size') {
          courant.journal.tailleMax = sansGuillemets(option[2]);
        } else {
          courant.journal.fichiersMax = sansGuillemets(option[2]);
        }
        continue;
      }
      // une autre option du pilote, plus profonde : sans objet ici
      if (new RegExp(`^ {${indentation + 2},}\\S`).test(ligne)) continue;
      dansJournal = false;
    }

    const item = new RegExp(`^ {${indentation + 2}}- (.+)$`).exec(ligne);
    if (item !== null && sequence !== null) {
      courant[sequence].push(item[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }

    const cle = new RegExp(`^ {${indentation}}([a-zA-Z_<>]+):\\s*(.*)$`).exec(
      ligne,
    );
    if (cle === null) continue;
    sequence = null;
    const valeur = cle[2].trim();
    switch (cle[1]) {
      case 'security_opt':
        sequence = 'securityOpt';
        courant.securityOpt.push(...sequenceEnLigne(valeur));
        break;
      case 'cap_drop':
        sequence = 'capDrop';
        courant.capDrop.push(...sequenceEnLigne(valeur));
        break;
      case 'cap_add':
        sequence = 'capAdd';
        courant.capAdd.push(...sequenceEnLigne(valeur));
        break;
      case 'secrets':
        sequence = 'secrets';
        courant.secrets.push(...sequenceEnLigne(valeur));
        break;
      case 'ports':
        sequence = 'ports';
        courant.ports.push(...sequenceEnLigne(valeur));
        break;
      case 'tmpfs':
        // séquence (bloc ou en ligne), ou chaîne seule : `tmpfs: /tmp`
        sequence = 'tmpfs';
        if (valeur.startsWith('[')) {
          courant.tmpfs.push(...sequenceEnLigne(valeur));
        } else if (valeur.length > 0) {
          courant.tmpfs.push(sansGuillemets(valeur));
        }
        break;
      case 'logging':
        // Déclaré, donc il REMPLACE celui de l'ancre (clé de fusion YAML).
        // La forme en ligne (`{driver: …}`) n'est pas lue : le journal reste
        // vide, et la règle 10 le refuse au lieu de le croire borné.
        courant.journal = journalVide();
        dansJournal = valeur.length === 0;
        break;
      case 'read_only':
        courant.readOnly = valeur === 'true';
        break;
      case 'privileged':
        courant.privileged = valeur === 'true';
        break;
      case '<<': {
        const nom = /^\*([a-zA-Z0-9_-]+)$/.exec(valeur);
        if (nom !== null) courant.ancres.push(nom[1]);
        break;
      }
      default:
        break;
    }
  }

  return { ancres, services };
}

/**
 * Posture d'un service dans UN compose, ancres résolues. Sémantique YAML de la
 * clé de fusion : ce que le service écrit lui-même l'emporte sur l'ancre.
 *
 * @param {Bloc} bloc
 * @param {Map<string, Bloc>} ancres
 * @returns {Bloc}
 */
function resoudre(bloc, ancres) {
  const resolu = blocVide();
  for (const nom of bloc.ancres) {
    const heritee = ancres.get(nom);
    if (heritee === undefined) {
      // ancre inconnue : on ne devine pas, la posture reste vide et la
      // vérification le dira.
      continue;
    }
    resolu.securityOpt.push(...heritee.securityOpt);
    resolu.capDrop.push(...heritee.capDrop);
    resolu.capAdd.push(...heritee.capAdd);
    resolu.secrets.push(...heritee.secrets);
    resolu.ports.push(...heritee.ports);
    resolu.tmpfs.push(...heritee.tmpfs);
    if (heritee.journal !== null) resolu.journal = { ...heritee.journal };
    if (heritee.readOnly !== null) resolu.readOnly = heritee.readOnly;
    if (heritee.privileged !== null) resolu.privileged = heritee.privileged;
  }
  if (bloc.securityOpt.length > 0) resolu.securityOpt = [...bloc.securityOpt];
  if (bloc.capDrop.length > 0) resolu.capDrop = [...bloc.capDrop];
  if (bloc.capAdd.length > 0) resolu.capAdd = [...bloc.capAdd];
  if (bloc.secrets.length > 0) resolu.secrets = [...bloc.secrets];
  if (bloc.ports.length > 0) resolu.ports = [...bloc.ports];
  // Un `tmpfs:` écrit par le service REMPLACE celui de l'ancre : c'est
  // exactement le piège que la règle 11 attrape (`/tmp` oublié en le réécrivant).
  if (bloc.tmpfs.length > 0) resolu.tmpfs = [...bloc.tmpfs];
  if (bloc.journal !== null) resolu.journal = { ...bloc.journal };
  if (bloc.readOnly !== null) resolu.readOnly = bloc.readOnly;
  if (bloc.privileged !== null) resolu.privileged = bloc.privileged;
  return resolu;
}

/**
 * Posture **effective** d'une pile : Compose CONCATÈNE les séquences au merge
 * (un override peut donc ajouter une capacité, jamais retirer celles retirées
 * par le fichier de base) et REMPLACE les scalaires.
 *
 * @param {string[]} composes
 * @param {Record<string, string>} contenus
 * @returns {Map<string, Bloc>}
 */
function postureDeLaPile(composes, contenus) {
  /** @type {Map<string, Bloc>} */
  const effective = new Map();
  for (const fichier of composes) {
    const { ancres, services } = analyser(contenus[fichier]);
    for (const [nom, bloc] of services) {
      const resolu = resoudre(bloc, ancres);
      const deja = effective.get(nom);
      if (deja === undefined) {
        effective.set(nom, resolu);
        continue;
      }
      deja.securityOpt.push(...resolu.securityOpt);
      deja.capDrop.push(...resolu.capDrop);
      deja.capAdd.push(...resolu.capAdd);
      deja.secrets.push(...resolu.secrets);
      deja.ports.push(...resolu.ports);
      deja.tmpfs.push(...resolu.tmpfs);
      deja.journal = fusionnerJournal(deja.journal, resolu.journal);
      if (resolu.readOnly !== null) deja.readOnly = resolu.readOnly;
      if (resolu.privileged !== null) deja.privileged = resolu.privileged;
    }
  }
  return effective;
}

/**
 * @param {Record<string, string>} contenus
 * @param {object} [registres] registres INJECTABLES : une sonde négative doit
 *   pouvoir abîmer le registre lui-même, pas seulement les composes — c'est le
 *   seul moyen d'éprouver la péremption d'une exemption maintenant que la liste
 *   des exemptions est VIDE (`AM-83`). Une sonde écrite sur `[0]` d'une liste
 *   vide ne mordrait plus : elle planterait.
 * @param {typeof CAPACITES_REPRISES} [registres.capacites]
 * @param {typeof RACINES_INSCRIPTIBLES} [registres.inscriptibles]
 * @returns {string[]}
 */
function verifier(contenus, registres = {}) {
  const capacitesReprises = registres.capacites ?? CAPACITES_REPRISES;
  const aSecretCopie = servicesASecretCopie(contenus);
  const racinesInscriptibles = registres.inscriptibles ?? RACINES_INSCRIPTIBLES;
  /** @type {string[]} */
  const constats = [];
  /** services vus au moins une fois, toutes piles confondues */
  const vus = new Set();
  /** mappings publiés lus, toutes piles confondues (garde anti-balayage à vide) */
  let portsLus = 0;
  /** capacités effectivement reprises, pour la péremption du registre */
  const reprisesVues = new Set();
  /** services effectivement inscriptibles, idem */
  const inscriptiblesVus = new Set();

  for (const pile of PILES) {
    /** ports publiés de CETTE pile : service → mappings, pour les règles 7-9 */
    const publiesDeLaPile = new Map();
    const effective = postureDeLaPile(pile.composes, contenus);
    if (effective.size === 0) {
      constats.push(
        `pile ${pile.nom} : aucun service trouvé dans ${pile.composes.join(' + ')} — le balayage ne mord plus (indentation ou nommage changé ?)`,
      );
      continue;
    }
    for (const [service, posture] of effective) {
      vus.add(service);

      if (posture.ports.length > 0) {
        publiesDeLaPile.set(service, posture.ports);
        portsLus += posture.ports.length;
      }
      if (pile.expositionLoopback === true) {
        for (const mapping of posture.ports) {
          if (borneALaLoopback(mapping)) continue;
          constats.push(
            `pile ${pile.nom}, service \`${service}\` : port publié \`${mapping}\` sans IP hôte loopback — Compose l'ouvre alors sur TOUTES les interfaces (\`0.0.0.0\` ET \`::\`), donc au LAN et au tailnet, que le pare-feu de l'hôte ne filtre PAS. Cette pile n'a aucun bord authentifiant à elle : le seul est le JWT Cloudflare Access, qu'un accès direct ne traverse pas (\`AM-94\`, mesuré le 2026-08-17 : 200 et le RFR des foyers sur \`/api/v1/foyers\` sans JWT). Préfixer par \`127.0.0.1:\`, et pour un accès distant passer par un tunnel SSH ou par l'URL publique.`,
          );
        }
      }

      if (!posture.securityOpt.includes('no-new-privileges:true')) {
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : pas de \`no-new-privileges:true\` (CIS 5.25) — un binaire setuid peut encore élever les privilèges du processus. Reprendre l'ancre \`<<: *durcissement\` du compose de base.`,
        );
      }
      if (!posture.capDrop.includes('ALL')) {
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : pas de \`cap_drop: [ALL]\` (CIS 5.3) — le noyau lui prête les ~14 capacités par défaut de Docker (dont NET_RAW). Reprendre l'ancre \`<<: *durcissement\` du compose de base.`,
        );
      }
      if (posture.privileged === true) {
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : \`privileged: true\` (CIS 5.4) — le mode privilégié REND toutes les capacités et désarme seccomp/AppArmor, quel que soit le \`cap_drop\` écrit à côté. Aucune exemption possible ici : ce qu'un conteneur privilégié demande se donne capacité par capacité.`,
        );
      }
      for (const entree of new Set(posture.securityOpt)) {
        if (affaiblit(entree)) {
          constats.push(
            `pile ${pile.nom}, service \`${service}\` : \`security_opt: ${entree}\` défait un profil de sécurité. Compose CONCATÈNE cette liste : l'entrée coexiste avec \`no-new-privileges:true\` sans l'annuler à la lecture, mais le conteneur, lui, tourne désarmé.`,
          );
        }
      }

      const declarees =
        capacitesReprises.find((c) => c.services.includes(service))
          ?.capacites ?? [];
      for (const capacite of new Set(posture.capAdd)) {
        if (!declarees.includes(capacite)) {
          constats.push(
            `pile ${pile.nom}, service \`${service}\` : reprend la capacité \`${capacite}\` sans motif — l'ajouter au registre \`CAPACITES_REPRISES\` de ce script, avec ce qu'elle rouvre, ou la retirer du compose.`,
          );
        }
        reprisesVues.add(`${service}/${capacite}`);
      }

      if (posture.readOnly === true && aSecretCopie.has(service)) {
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : \`read_only: true\` alors qu'il reçoit un secret Compose de source \`environment:\`. Compose matérialise CE type de secret par une COPIE dans le conteneur, que le démon refuse sur une racine immuable (« container rootfs is marked read-only ») : le conteneur est créé, jamais démarré, et \`up -d --wait\` échoue — en PRODUCTION seulement, là où le secret est déclaré, donc hors de portée de toute pile de CI. Reprendre l'ancre \`<<: *durcissement-inscriptible\` avec son motif, ou passer le secret en source \`file:\` (monté, pas copié).`,
        );
      }

      const exemption = racinesInscriptibles.find((e) => e.service === service);
      if (posture.readOnly !== true && exemption === undefined) {
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : racine inscriptible (CIS 5.12) sans exemption déclarée — poser \`read_only: true\` (au besoin avec un \`tmpfs:\` pour les écritures légitimes), ou déclarer l'exemption avec son motif dans \`RACINES_INSCRIPTIBLES\`.`,
        );
      }
      // La péremption d'une exemption se juge **globalement**, plus bas : un
      // service en lecture seule dans une pile et inscriptible dans une autre
      // a besoin de son entrée. La signaler ici mettrait l'auteur devant un
      // refus sans issue — ni garder ni retirer l'entrée ne ferait passer la
      // porte (`LE-52` : un refus doit avoir un remède atteignable).
      if (posture.readOnly !== true) inscriptiblesVus.add(service);

      if (!journalBorne(posture.journal)) {
        const lu =
          posture.journal === null
            ? 'aucun `logging:`'
            : `pilote \`${posture.journal.pilote ?? '—'}\`, max-size \`${posture.journal.tailleMax ?? '—'}\`, max-file \`${posture.journal.fichiersMax ?? '—'}\``;
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : journal Docker non borné (${lu}). Sans \`max-size\`, le journal ne repart à zéro qu'à la recréation du conteneur, et un conteneur dont ni l'image ni la configuration ne changent n'est jamais recréé : celui de loki a atteint 125 Go en trois mois (\`LE-105\`). Reprendre l'ancre \`<<: *durcissement\`, ou écrire en bloc \`logging: { driver: json-file, options: { max-size, max-file } }\`.`,
        );
      }

      if (posture.readOnly === true && !aUnTmpInscriptible(posture.tmpfs)) {
        constats.push(
          `pile ${pile.nom}, service \`${service}\` : racine en lecture seule sans \`/tmp\` inscriptible (tmpfs lus : ${posture.tmpfs.length === 0 ? 'aucun' : posture.tmpfs.map((t) => `\`${t}\``).join(', ')}). Une écriture refusée dans \`/tmp\` peut vivre dans un chemin que ni le démarrage ni le healthcheck n'exercent : la rétention de loki n'a jamais tourné, \`/ready\` répondait (\`LE-105\`). Un \`tmpfs:\` écrit par le service REMPLACE celui de l'ancre : y relister \`/tmp\`.`,
        );
      }
    }

    if (publiesDeLaPile.size === 0) {
      constats.push(
        `pile ${pile.nom} : aucun port publié lu — une pile sans port publié n'a plus de sonde de déploiement locale, et surtout : un balayage qui ne trouve rien ÉCHOUE ici (la règle « loopback seulement » serait verte par vacuité).`,
      );
    }

    // La porte 3 de `deploy.mjs` (santé/seed/perf) DÉRIVE son URL du port
    // loopback publié par la pile de production (`portSondeLoopback()`). Retirer
    // ce port ne casserait rien de visible en CI : le déploiement suivant
    // retomberait sur `SERVER_ORIGIN` — l'origine LAN, plus jamais joignable
    // depuis qu'`AM-94` a fermé Caddy — et échouerait en porte 3, puis en
    // rollback. C'est donc ici que ça doit rougir.
    if (Array.isArray(pile.sondeDeploiement)) {
      const porteuse = pile.sondeDeploiement.find((service) =>
        (publiesDeLaPile.get(service) ?? []).some(borneALaLoopback),
      );
      if (porteuse === undefined) {
        constats.push(
          `pile ${pile.nom} : aucun port loopback publié sur ${pile.sondeDeploiement.map((s) => `\`${s}\``).join(' ni ')} — la porte 3 de \`scripts/deploy.mjs\` en dérive son URL de sonde (santé/seed/perf) et n'aurait plus de chemin vers l'application : elle retomberait sur \`SERVER_ORIGIN\`, l'origine LAN que ce même correctif a rendue injoignable.`,
        );
      }
    }
  }

  if (portsLus === 0) {
    constats.push(
      "aucun mapping de port lu dans les composes : l'analyse des `ports:` ne mord plus (indentation ou forme changée ?).",
    );
  }

  if (vus.size === 0) {
    constats.push(
      'aucun service analysé dans les composes : la porte ne regarde plus rien.',
    );
    return constats;
  }

  // Péremption du registre, dans l'autre sens.
  for (const entree of capacitesReprises) {
    for (const service of entree.services) {
      if (!vus.has(service)) {
        constats.push(
          `le registre \`CAPACITES_REPRISES\` nomme \`${service}\`, qu'aucun compose ne définit : entrée périmée, la retirer.`,
        );
        continue;
      }
      for (const capacite of entree.capacites) {
        if (!reprisesVues.has(`${service}/${capacite}`)) {
          constats.push(
            `le registre \`CAPACITES_REPRISES\` accorde \`${capacite}\` à \`${service}\`, qu'aucun compose ne reprend : entrée périmée, la retirer (une capacité qu'on n'accorde plus ne doit pas rester écrite comme accordée).`,
          );
        }
      }
    }
  }
  for (const exemption of racinesInscriptibles) {
    if (!vus.has(exemption.service)) {
      constats.push(
        `le registre \`RACINES_INSCRIPTIBLES\` nomme \`${exemption.service}\`, qu'aucun compose ne définit : entrée périmée, la retirer.`,
      );
    } else if (!inscriptiblesVus.has(exemption.service)) {
      constats.push(
        `le registre \`RACINES_INSCRIPTIBLES\` exempte \`${exemption.service}\`, dont la racine est en lecture seule partout : entrée périmée, la retirer.`,
      );
    }
    if (exemption.motif.trim().length === 0) {
      constats.push(
        `l'exemption de \`${exemption.service}\` n'a pas de motif : une exemption sans motif n'existe pas.`,
      );
    }
  }

  return constats;
}

/**
 * Sondes négatives. Chacune **dérive** sa mutation des fichiers réels : trois
 * sondes de ce dépôt écrites sur un littéral ont cessé de mordre en silence
 * (`LE-22`, `LE-33`).
 *
 * @param {Record<string, string>} contenus
 */
function autotest(contenus) {
  /**
   * Mutation d'un fichier réel, avec **garde** : une mutation qui ne change rien
   * fait échouer la sonde ici, au lieu de laisser la porte « ne pas mordre » sur
   * un fichier intact et d'accuser la porte (piège CRLF, `LE-33`).
   *
   * @param {string} fichier
   * @param {(texte: string) => string} transformation
   * @param {string} etiquette
   * @returns {Record<string, string>}
   */
  function muter(fichier, transformation, etiquette) {
    const source = contenus[fichier];
    const mute = transformation(source);
    if (mute === source) {
      throw new Error(
        `sonde « ${etiquette} » : la mutation n'a RIEN changé — la sonde est périmée (motif introuvable dans le fichier réel), pas la porte.`,
      );
    }
    return { ...contenus, [fichier]: mute };
  }

  /** Premier service du compose de base : dérivé, jamais écrit en dur. */
  const temoin = [...analyser(contenus[BASE]).services.keys()][0];
  if (temoin === undefined) {
    console.error('Sonde impossible : aucun service lisible dans le compose.');
    return 1;
  }

  /** @type {{ nom: string, constats: string[], attendu: string }[]} */
  const sondes = [];

  // (a) un service perd son ancre de durcissement.
  sondes.push({
    nom: `service sans posture (${temoin})`,
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(
            new RegExp(
              `(\\n {2}${temoin}:\\r?\\n) {4}<<: \\*durcissement\\r?\\n`,
            ),
            '$1',
          ),
        'service sans posture',
      ),
    ),
    attendu: 'no-new-privileges',
  });

  // (b) un service NEUF arrive sans posture (le cas réel : une PR ajoute un
  // conteneur, personne ne pense à l'ancre).
  sondes.push({
    nom: 'service neuf sans posture',
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(
            /\nservices:\r?\n/,
            '\nservices:\n  service-neuf:\n    image: alpine:3.20\n',
          ),
        'service neuf',
      ),
    ),
    attendu: '`service-neuf`',
  });

  // (c) une capacité est reprise sans figurer au registre.
  sondes.push({
    nom: 'capacité reprise sans motif',
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(
            new RegExp(`(\\n {2}${temoin}:\\r?\\n)`),
            '$1    cap_add:\n      - NET_RAW\n',
          ),
        'capacité sans motif',
      ),
    ),
    attendu: 'NET_RAW',
  });

  // (d) l'ancre partagée cesse d'imposer la lecture seule : 24 services
  // basculent d'un coup, sans qu'aucune ligne de service ne change.
  sondes.push({
    nom: 'ancre partagée qui cesse de durcir',
    constats: verifier(
      muter(
        BASE,
        (t) => t.replace(/read_only: true\r?\n/, 'read_only: false\n'),
        'ancre sans read_only',
      ),
    ),
    attendu: 'racine inscriptible',
  });

  // (e) le service que seule la PRODUCTION lève perd sa posture — la pile
  // dev/CI, elle, resterait verte.
  sondes.push({
    nom: 'service de production sans posture (caddy)',
    constats: verifier(
      muter(
        'docker-compose.server.yml',
        (t) =>
          t.replace(
            /\n {4}security_opt:\r?\n {6}- 'no-new-privileges:true'\r?\n {4}cap_drop:\r?\n {6}- ALL\r?\n {4}cap_add:\r?\n {6}- NET_BIND_SERVICE\r?\n/,
            '\n',
          ),
        'caddy sans posture',
      ),
    ),
    attendu: 'production, service `caddy`',
  });

  // (f) une exemption devenue fausse : le service est en lecture seule partout,
  // son entrée reste au registre. C'est le REGISTRE qu'on abîme ici, pas le
  // compose — depuis `AM-83` la liste des exemptions est vide, et une sonde qui
  // irait chercher `RACINES_INSCRIPTIBLES[0]` planterait au lieu de mordre.
  // Le témoin est dérivé : le premier service durci du compose de base.
  sondes.push({
    nom: `exemption périmée (registre, témoin ${temoin})`,
    constats: verifier(contenus, {
      inscriptibles: [
        {
          service: temoin,
          motif: 'exemption fabriquée par la sonde, sans objet dans le compose',
        },
      ],
    }),
    attendu: 'dont la racine est en lecture seule partout',
  });

  // (f ter) le cas qui a cassé la PRODUCTION le 2026-08-15 : un service qui
  // reçoit un secret Compose de source `environment:` passe en racine immuable.
  // La copie du secret est refusée par le démon, le conteneur ne démarre jamais,
  // et AUCUNE pile de CI ne peut le voir — le secret n'existe qu'en production.
  sondes.push({
    nom: 'racine immuable sur un service à secret copié (alertmanager)',
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(
            /(\n {2}alertmanager:\r?\n(?: {4}#[^\n]*\r?\n)*) {4}<<: \*durcissement-inscriptible/,
            '$1    <<: *durcissement',
          ),
        'secret copié en racine immuable',
      ),
    ),
    attendu: 'secret Compose de source',
  });

  // (f bis) une exemption qui nomme un service qu'aucun compose ne définit.
  sondes.push({
    nom: 'exemption nommant un service inexistant',
    constats: verifier(contenus, {
      inscriptibles: [
        { service: 'service-disparu', motif: 'entrée que rien ne porte plus' },
      ],
    }),
    attendu: '`service-disparu`',
  });

  // (g) le mode privilégié, qui REND tout ce que `cap_drop` vient de retirer —
  // sans qu'aucune des lignes de durcissement ne change.
  sondes.push({
    nom: 'mode privilégié qui rend toutes les capacités',
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(
            new RegExp(`(\\n {2}${temoin}:\\r?\\n)`),
            '$1    privileged: true\n',
          ),
        'mode privilégié',
      ),
    ),
    attendu: 'privileged: true',
  });

  // (h) un override ajoute un profil désarmé. Compose CONCATÈNE `security_opt` :
  // `no-new-privileges:true` reste présent, la ligne se lit comme durcie.
  const temoinOverride = [
    ...analyser(contenus['docker-compose.override.yml']).services.keys(),
  ][0];
  sondes.push({
    nom: `profil de sécurité défait par un override (${temoinOverride})`,
    constats: verifier(
      muter(
        'docker-compose.override.yml',
        (t) =>
          t.replace(
            new RegExp(`(\\n {2}${temoinOverride}:\\r?\\n)`),
            "$1    security_opt:\n      - 'seccomp:unconfined'\n",
          ),
        'profil désarmé',
      ),
    ),
    attendu: 'défait un profil de sécurité',
  });

  // (i) LE cas d'`AM-94` : un port de production perd son préfixe loopback. Le
  // conteneur démarre parfaitement, la pile est « verte », et l'application est
  // servie au LAN et au tailnet sans identité.
  sondes.push({
    nom: 'port de production republié hors loopback (caddy)',
    constats: verifier(
      muter(
        'docker-compose.server.yml',
        (t) =>
          t.replace(
            /- '127\.0\.0\.1:\$\{CADDY_HTTPS_PORT:-443\}:443'/,
            "- '${CADDY_HTTPS_PORT:-443}:443'",
          ),
        'port prod hors loopback',
      ),
    ),
    attendu: 'sans IP hôte loopback',
  });

  // (i bis) même mutation, mais écrite en `0.0.0.0:` explicite — la forme que
  // personne ne relit comme une ouverture.
  sondes.push({
    nom: 'port de production publié en 0.0.0.0 explicite (caddy)',
    constats: verifier(
      muter(
        'docker-compose.server.yml',
        (t) =>
          t.replace(
            /- '127\.0\.0\.1:(\$\{CADDY_HTTPS_PORT:-443\}:443)'/,
            "- '0.0.0.0:$1'",
          ),
        'port prod en 0.0.0.0',
      ),
    ),
    attendu: 'sans IP hôte loopback',
  });

  // (j) le port de sonde de la porte 3 disparaît : rien ne casse en CI, le
  // déploiement suivant échoue en porte 3 puis en rollback.
  sondes.push({
    nom: 'production sans port de sonde pour la porte 3 (web)',
    constats: verifier(
      muter(
        'docker-compose.server.yml',
        (t) => t.replace(/\n {6}- '127\.0\.0\.1:4220:80'/, ''),
        'sonde de déploiement retirée',
      ),
    ),
    attendu: 'la porte 3 de `scripts/deploy.mjs`',
  });

  // (k) l'analyse des `ports:` cesse de mordre (indentation changée) : la règle
  // « loopback seulement » serait alors verte par vacuité, sur les trois piles.
  sondes.push({
    nom: 'analyse des ports à vide (indentation changée)',
    constats: verifier(
      muter(
        'docker-compose.override.yml',
        (t) => t.replace(/^ {4}ports:$/gm, '    ports :'),
        'ports illisibles',
      ),
    ),
    attendu: 'aucun port publié lu',
  });

  // (l) LE cas de `LE-105`, côté journal : l'ancre partagée perd sa borne.
  // Tous les services qui la reprennent basculent d'un coup, sans qu'aucune
  // ligne de service ne change.
  sondes.push({
    nom: 'ancre partagée qui cesse de borner le journal',
    constats: verifier(
      muter(
        BASE,
        (t) => t.replace(/\n {6}max-size: '10m'\r?\n/, '\n'),
        'ancre sans max-size',
      ),
    ),
    attendu: 'journal Docker non borné',
  });

  // (l bis) le service que seule la PRODUCTION lève perd sa borne : les piles
  // dev/CI et staging, elles, resteraient vertes.
  sondes.push({
    nom: 'service de production sans borne de journal (caddy)',
    constats: verifier(
      muter(
        'docker-compose.server.yml',
        (t) =>
          t.replace(
            /(\n {2}caddy:\r?\n[\s\S]*?)\n {4}logging:\r?\n {6}driver: json-file\r?\n {6}options:\r?\n {8}max-size: '10m'\r?\n {8}max-file: '3'\r?\n/,
            '$1\n',
          ),
        'caddy sans logging',
      ),
    ),
    attendu: 'service `caddy` : journal Docker non borné',
  });

  // (l ter) un pilote qui ne borne rien, `max-size` laissé en place.
  sondes.push({
    nom: 'pilote de journal changé dans l’ancre',
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(/\n {4}driver: json-file\r?\n/, '\n    driver: journald\n'),
        'pilote journald',
      ),
    ),
    attendu: 'pilote `journald`',
  });

  // (m) LE cas de `LE-105`, côté `/tmp` : l'ancre perd son tmpfs, et loki
  // redevient le conteneur « healthy » dont la rétention ne tourne jamais.
  sondes.push({
    nom: 'ancre partagée sans /tmp (loki)',
    constats: verifier(
      muter(
        BASE,
        (t) => t.replace(/\n {2}tmpfs:\r?\n {4}- \/tmp\r?\n/, '\n'),
        'ancre sans tmpfs',
      ),
    ),
    attendu: 'service `loki` : racine en lecture seule sans `/tmp`',
  });

  // (m bis) le piège de la clé de fusion : un service écrit son propre
  // `tmpfs:` pour un autre chemin, et perd sans le voir le `/tmp` de l'ancre.
  // Témoin dérivé : le premier service du compose de base qui liste `/tmp`
  // APRÈS un autre montage.
  const reecrit =
    /\n {2}([a-zA-Z0-9_.-]+):\r?\n(?: {4}[^\n]*\r?\n)*? {4}tmpfs:\r?\n(?: {6}#[^\n]*\r?\n)*(?: {6}- (?!\/tmp\b)[^\n]+\r?\n)+ {6}- \/tmp\r?\n/.exec(
      contenus[BASE],
    );
  if (reecrit === null) {
    console.error(
      'Sonde impossible : aucun service du compose de base ne liste `/tmp` après un autre montage tmpfs.',
    );
    return 1;
  }
  sondes.push({
    nom: `tmpfs réécrit sans /tmp (${reecrit[1]})`,
    constats: verifier(
      muter(
        BASE,
        (t) =>
          t.replace(reecrit[0], () =>
            reecrit[0].replace(/ {6}- \/tmp\r?\n$/, ''),
          ),
        'tmpfs réécrit sans /tmp',
      ),
    ),
    attendu: `service \`${reecrit[1]}\` : racine en lecture seule sans \`/tmp\``,
  });

  let echecs = 0;
  for (const sonde of sondes) {
    const mord = sonde.constats.some((c) => c.includes(sonde.attendu));
    if (mord) {
      console.log(`Sonde « ${sonde.nom} » : la porte mord. ✅`);
    } else {
      echecs += 1;
      console.error(
        `Sonde « ${sonde.nom} » : la porte n'a RIEN vu (attendu : ${sonde.attendu}). Elle ne mord plus.`,
      );
    }
  }
  return echecs === 0 ? 0 : 1;
}

function principal() {
  /** @type {Record<string, string>} */
  const contenus = {};
  for (const pile of PILES) {
    for (const fichier of pile.composes) {
      contenus[fichier] = contenus[fichier] ?? lire(fichier);
    }
  }

  if (process.argv.includes('--autotest')) {
    return autotest(contenus);
  }

  const constats = verifier(contenus);
  if (constats.length > 0) {
    console.error(
      `Durcissement des conteneurs — ${constats.length} constat(s) :`,
    );
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }

  const services = new Set();
  /** ports publiés des piles hébergées (prod + staging), tous en loopback ici. */
  let portsHeberges = 0;
  for (const pile of PILES) {
    for (const [nom, posture] of postureDeLaPile(pile.composes, contenus)) {
      services.add(nom);
      if (pile.expositionLoopback === true)
        portsHeberges += posture.ports.length;
    }
  }
  console.log(
    `Durcissement des conteneurs : ${services.size} service(s) sur ${PILES.length} piles, ` +
      `tous en no-new-privileges + cap_drop ALL ; ` +
      `tous au journal Docker borné ; ` +
      `${services.size - RACINES_INSCRIPTIBLES.length} en racine lecture seule, chacun avec un /tmp en tmpfs, ` +
      `${RACINES_INSCRIPTIBLES.length} exemption(s) motivée(s), ` +
      `${CAPACITES_REPRISES.reduce((n, c) => n + c.services.length, 0)} service(s) reprenant une capacité déclarée ; ` +
      `${portsHeberges} port(s) publié(s) sur les piles hébergées, tous bornés à la loopback.`,
  );
  return 0;
}

process.exitCode = principal();
