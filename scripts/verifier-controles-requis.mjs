#!/usr/bin/env node
// @ts-check
/**
 * Engendre — et garde — la phrase de `CLAUDE.md` qui énonce les contrôles
 * REQUIS par la protection de `main`.
 *
 * ## Pourquoi ce script existe
 *
 * Le 2026-10-03, `CLAUDE.md` annonçait **deux** contrôles requis (`ci` et
 * `config-validation`). Il y en avait **cinq** depuis le 2026-09-30 : `texte-pr`,
 * `lint-ratchet` et `mutation-delta` s'étaient ajoutés sans que la phrase bouge.
 * Elle était vraie le jour où elle a été écrite. Elle ne l'est plus, et c'est le
 * document que lit en premier quiconque — humain ou agent — arrive sur le dépôt :
 * une session entière peut se tromper de cible sur cette seule ligne.
 *
 * Même cause que partout ailleurs ici : **une affirmation RÉDIGÉE à la main
 * pourrit**. Le remède du dépôt est connu — `pnpm faits`, `pnpm readme` — et c'est
 * son extension directe : l'affirmation est ENGENDRÉE, et la porte refuse que le
 * fichier versionné diverge de ce qu'engendrerait le relevé.
 *
 * ## La difficulté, et l'arbitrage qu'elle impose
 *
 * La source de vérité — `GET /repos/{depot}/branches/{branche}/protection` —
 * exige la permission *Administration (read)*. Une porte de CI qui l'appellerait
 * à chaque PR dépendrait d'un droit, d'un secret et du réseau : elle échouerait
 * un jour pour une raison qui n'a rien à voir avec la documentation, et elle
 * serait désactivée. On ne remplace pas un fait périmé par une porte fragile.
 *
 * Le relevé est donc **découpé en deux temps** (cf. ADR-0013) :
 *
 *  - `pnpm controles --relever` — interroge l'API et réécrit
 *    `scripts/controles-requis.json`. Se joue À LA MAIN, hors CI, avec un jeton
 *    qui a le droit de lire. C'est le seul endroit qui touche au réseau.
 *  - `pnpm controles` — en CI : **aucun réseau**. Confronte le bloc engendré de
 *    `CLAUDE.md` à ce que le relevé versionné produirait, caractère pour
 *    caractère, et vérifie la forme du relevé lui-même.
 *  - `pnpm controles --ecrire` — réécrit le bloc de `CLAUDE.md` depuis le relevé.
 *
 * ## Ce que la porte NE peut pas savoir
 *
 * La frontière est nette, et il faut la connaître pour ne pas se croire couvert :
 * **la porte ne sait pas si le relevé lui-même est à jour.** Elle garantit que la
 * documentation dit exactement ce que dit le relevé, pas que le relevé dise ce
 * que dit GitHub. Un changement de protection non suivi d'un `--relever` passe au
 * travers. Seule contre-mesure ici : la date `releveLe`, dont la porte AVERTIT
 * passé 90 jours — et le job non bloquant `controles-requis-droits` de `ci.yml`,
 * qui mesure si le jeton par défaut pourrait un jour lire la protection
 * lui-même. Si la réponse est oui, cette porte pourra devenir un vrai
 * différentiel ; tant qu'elle est non, le relevé reste un geste humain.
 *
 * ## Usage
 *   pnpm controles              # vérifie (CI, hors ligne)
 *   pnpm controles --ecrire     # réécrit le bloc de CLAUDE.md depuis le relevé
 *   pnpm controles --relever    # réinterroge GitHub et réécrit le relevé
 *   pnpm controles --autotest   # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : relevé illisible, bloc absent, liste vide
 *    ⇒ ÉCHEC.
 *  - Lectures `fs` en `try/catch` seul (règle CodeQL `js/file-system-race`).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const RELEVE = 'scripts/controles-requis.json';
const DOCUMENT = 'CLAUDE.md';
const DEBUT = '<!-- FAITS:controles-requis -->';
const FIN = '<!-- /FAITS:controles-requis -->';
/** Au-delà, le relevé est vieux au point qu'on ne devrait plus s'y fier seul. */
const PEREMPTION_JOURS = 90;

/** @typedef {{ portee: string, message: string, remede?: string }} Constat */

/** @type {Constat[]} */
const erreurs = [];
/** @type {Constat[]} */
const avertissements = [];
const faitsVerifies = new Set();

/** @param {string} portee @param {string} message @param {string} [remede] */
function erreur(portee, message, remede) {
  erreurs.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
  );
}

/** @param {string} portee @param {string} message @param {string} [remede] */
function avertir(portee, message, remede) {
  avertissements.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
  );
}

/** Lecteur INJECTABLE : `--autotest` abîme en mémoire, jamais sur disque. */
let lecteur = (relatif) => {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
};

const aujourdhui = () => new Date();

function jourValide(texte) {
  if (typeof texte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) {
    return null;
  }
  const date = new Date(`${texte}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === texte ? date : null;
}

/**
 * LE RENDU — la seule fonction qui écrit la phrase. Tout le reste la compare.
 * Si deux endroits savaient l'écrire, ils divergeraient : c'est le défaut même
 * que ce script traite.
 *
 * @param {any} releve
 * @returns {string} le contenu du bloc, sans ses marqueurs
 */
function rendre(releve) {
  const liste = releve.controles.map((c) => `\`${c}\``).join(', ');
  const strict = releve.strict
    ? 'branche à jour exigée avant fusion'
    : 'branche à jour NON exigée';
  const revues =
    releve.revuesRequises === 0
      ? 'aucune revue requise'
      : `${releve.revuesRequises} revue(s) requise(s)`;
  const admins = releve.administrateursSoumis
    ? 'administrateurs soumis à la protection'
    : 'administrateurs NON soumis à la protection';
  // Lignes vides en tête et en queue : c'est la forme que Prettier impose
  // autour d'un commentaire HTML en markdown. Les écrire d'emblée évite que
  // `--ecrire` et `prettier --write` se contredisent à chaque passe.
  return [
    '',
    '',
    `- Contrôles **requis** par la protection de \`${releve.branche}\` — ${releve.controles.length} au`,
    `  ${releve.releveLe} : ${liste}.`,
    `  Protection : ${strict}, ${revues}, ${admins}.`,
    '  Cette liste est **engendrée** (`pnpm controles --ecrire`) depuis le relevé',
    `  \`${RELEVE}\` : ne pas la rédiger à la main.`,
    '',
    '',
  ].join('\n');
}

/** Le relevé, validé dans sa FORME. Rend `null` et consigne si quelque chose cloche. */
function lireReleve() {
  const brut = lecteur(RELEVE);
  if (brut === null) {
    erreur(
      RELEVE,
      'relevé illisible — la porte ne garde rien.',
      '`pnpm controles --relever` le réengendre depuis l’API GitHub.',
    );
    return null;
  }
  let releve;
  try {
    releve = JSON.parse(brut);
  } catch (cause) {
    erreur(RELEVE, `relevé illisible comme JSON : ${String(cause)}.`);
    return null;
  }

  const manques = [];
  if (typeof releve?.branche !== 'string' || releve.branche === '') {
    manques.push('branche');
  }
  if (!Array.isArray(releve?.controles) || releve.controles.length === 0) {
    manques.push('controles (liste non vide)');
  } else if (releve.controles.some((c) => typeof c !== 'string' || c === '')) {
    manques.push('controles (que des noms non vides)');
  }
  if (typeof releve?.strict !== 'boolean') manques.push('strict (booléen)');
  if (!Number.isInteger(releve?.revuesRequises)) {
    manques.push('revuesRequises (entier)');
  }
  if (typeof releve?.administrateursSoumis !== 'boolean') {
    manques.push('administrateursSoumis (booléen)');
  }
  const date = jourValide(releve?.releveLe);
  if (date === null) manques.push('releveLe (AAAA-MM-JJ)');

  if (manques.length > 0) {
    erreur(
      RELEVE,
      `relevé incomplet ou mal formé : ${manques.join(', ')}.`,
      'ne pas éditer ce fichier à la main : `pnpm controles --relever`.',
    );
    return null;
  }
  faitsVerifies.add('releve-forme');

  const age = Math.floor(
    (aujourdhui().getTime() - /** @type {Date} */ (date).getTime()) /
      86_400_000,
  );
  if (age > PEREMPTION_JOURS) {
    avertir(
      RELEVE,
      `relevé vieux de ${age} jours (${releve.releveLe}) — la porte garantit que la doc dit ce que dit le relevé, pas que le relevé dise ce que dit GitHub.`,
      'rejouer `pnpm controles --relever`, puis `pnpm controles --ecrire`.',
    );
  }
  return releve;
}

/** Le bloc engendré de `CLAUDE.md`, ou `null`. */
function lireBloc(contenu) {
  const debut = contenu.indexOf(DEBUT);
  const fin = contenu.indexOf(FIN);
  if (debut === -1 || fin === -1 || fin < debut) return null;
  return contenu.slice(debut + DEBUT.length, fin);
}

function reinitialiser() {
  erreurs.length = 0;
  avertissements.length = 0;
  faitsVerifies.clear();
}

function executer() {
  reinitialiser();
  const releve = lireReleve();
  if (releve === null) return { attendus: [...faitsVerifies] };

  const contenu = lecteur(DOCUMENT);
  if (contenu === null) {
    erreur(DOCUMENT, 'document illisible.');
    return { attendus: [...faitsVerifies] };
  }

  const bloc = lireBloc(contenu);
  if (bloc === null) {
    erreur(
      DOCUMENT,
      `le bloc engendré est absent (marqueurs \`${DEBUT}\` … \`${FIN}\`) — le fait a disparu du document, et la porte ne garde plus rien.`,
      '`pnpm controles --ecrire` le repose ; les marqueurs, eux, se remettent à la main.',
    );
    return { attendus: [...faitsVerifies] };
  }
  faitsVerifies.add('bloc-present');

  // Comparaison insensible aux fins de ligne : sur un poste Windows le fichier
  // est en CRLF sur disque et en LF dans l'index (piège `EM-07`). Juger les
  // `\r` ferait une porte rouge en local sur un fichier intact.
  // `.trim()` : le nombre de lignes vides AUTOUR du bloc appartient au
  // formateur, pas au fait. Les juger ferait une porte qui rougit après un
  // simple `prettier --write` — une porte qu'on finirait par contourner.
  const attendu = rendre(releve).replace(/\r\n/g, '\n').trim();
  const observe = bloc.replace(/\r\n/g, '\n').trim();
  if (observe !== attendu) {
    erreur(
      DOCUMENT,
      'le bloc engendré DIVERGE de ce que produit le relevé versionné.',
      '`pnpm controles --ecrire` — et si c’est la protection qui a changé, `pnpm controles --relever` d’abord.',
    );
    console.error('--- attendu ---');
    console.error(attendu);
    console.error('--- observé ---');
    console.error(observe);
  }
  faitsVerifies.add('bloc-confronte');

  // Sonde de vacuité : le document doit CITER les contrôles ailleurs que dans
  // le bloc serait une recopie — on vérifie l'inverse, qu'aucune autre phrase
  // du document ne prétende énoncer la liste.
  const horsBloc = contenu.replace(bloc, '');
  if (/Contr[oô]les?\s+\*\*requis\*\*/.test(horsBloc)) {
    erreur(
      DOCUMENT,
      'une seconde phrase énonce les contrôles requis HORS du bloc engendré — c’est la recopie qui revient.',
      'la supprimer : une seule source, engendrée.',
    );
  }
  faitsVerifies.add('pas-de-recopie');

  return { attendus: [...faitsVerifies] };
}

/** Réécrit le bloc de `CLAUDE.md` depuis le relevé. */
function ecrire() {
  const releve = lireReleve();
  if (releve === null) return 1;
  const chemin = path.join(RACINE, DOCUMENT);
  let contenu;
  try {
    contenu = fs.readFileSync(chemin, 'utf8');
  } catch (cause) {
    console.error(`❌ ${DOCUMENT} illisible : ${String(cause)}`);
    return 1;
  }
  const debut = contenu.indexOf(DEBUT);
  const fin = contenu.indexOf(FIN);
  if (debut === -1 || fin === -1 || fin < debut) {
    console.error(
      `❌ marqueurs absents de ${DOCUMENT} — les poser à la main une fois :\n${DEBUT}\n${FIN}`,
    );
    return 1;
  }
  const refait =
    contenu.slice(0, debut + DEBUT.length) +
    rendre(releve) +
    contenu.slice(fin);
  if (refait === contenu) {
    console.log(`✅ ${DOCUMENT} était déjà conforme au relevé.`);
    return 0;
  }
  fs.writeFileSync(chemin, refait, 'utf8');
  console.log(`✅ bloc réengendré dans ${DOCUMENT}.`);
  return 0;
}

/**
 * Réinterroge GitHub et réécrit le relevé. SEUL chemin qui touche au réseau, et
 * il ne tourne jamais en CI : voir l'en-tête et l'ADR-0013.
 */
async function relever() {
  const releveActuel = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RACINE, RELEVE), 'utf8'));
    } catch {
      return null;
    }
  })();
  const depot =
    process.env.GITHUB_REPOSITORY ??
    releveActuel?.depot ??
    'EdouardZemb/creche-planner';
  const branche = releveActuel?.branche ?? 'main';

  let jeton = process.env.GITHUB_TOKEN ?? '';
  if (jeton === '') {
    try {
      // Import gardé LIÉ à son module (pas de déstructuration) : la règle
      // `@typescript-eslint/unbound-method` compterait sinon un warning de
      // plus, et le ratchet ESLint est exactement à son plafond.
      const enfant = await import('node:child_process');
      jeton = enfant
        .execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' })
        .trim();
    } catch {
      jeton = '';
    }
  }
  if (jeton === '') {
    console.error(
      '❌ aucun jeton : poser `GITHUB_TOKEN`, ou s’authentifier avec `gh auth login`.\n' +
        '   La lecture de la protection de branche exige la permission *Administration (read)*.',
    );
    return 1;
  }

  const url = `https://api.github.com/repos/${depot}/branches/${branche}/protection`;
  const reponse = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jeton}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'verifier-controles-requis',
    },
  });
  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    console.error(
      `❌ GET protection → HTTP ${reponse.status}. ${detail.slice(0, 300)}\n` +
        '   Un échec n’est JAMAIS écrit comme « aucun contrôle requis » : le relevé reste tel quel.',
    );
    return 1;
  }
  const corps = await reponse.json();
  const controles = corps?.required_status_checks?.contexts;
  if (!Array.isArray(controles)) {
    console.error(
      '❌ réponse sans `required_status_checks.contexts` — forme inattendue, relevé laissé intact.',
    );
    return 1;
  }

  const refait = {
    _lisezMoi: releveActuel?._lisezMoi ?? '',
    depot,
    branche,
    source: 'GET /repos/{depot}/branches/{branche}/protection',
    releveLe: aujourdhui().toISOString().slice(0, 10),
    controles: [...controles],
    strict: corps?.required_status_checks?.strict === true,
    revuesRequises:
      corps?.required_pull_request_reviews?.required_approving_review_count ??
      0,
    administrateursSoumis: corps?.enforce_admins?.enabled === true,
  };
  fs.writeFileSync(
    path.join(RACINE, RELEVE),
    `${JSON.stringify(refait, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `✅ relevé réengendré : ${refait.controles.length} contrôle(s) requis — ${refait.controles.join(', ')}.`,
  );
  console.log('   Enchaîner avec `pnpm controles --ecrire`.');
  return 0;
}

/** @param {{ attendus: string[] }} bilan */
function conclure({ attendus }) {
  const ATTENDUS = [
    'releve-forme',
    'bloc-present',
    'bloc-confronte',
    'pas-de-recopie',
  ];
  for (const fait of ATTENDUS) {
    if (!attendus.includes(fait)) {
      erreur(
        'balayage',
        `le contrôle « ${fait} » n’a pas eu lieu — la porte a rendu un verdict sans regarder.`,
      );
    }
  }
  for (const { portee, message, remede } of avertissements) {
    console.warn(`⚠️  ${portee} — ${message}`);
    if (remede !== undefined) console.warn(`    → ${remede}`);
  }
  for (const { portee, message, remede } of erreurs) {
    console.error(`❌ ${portee} — ${message}`);
    if (remede !== undefined) console.error(`    → ${remede}`);
  }
  if (erreurs.length === 0) {
    console.log('✅ le bloc de CLAUDE.md dit exactement ce que dit le relevé.');
  }
  console.log(
    `\n  ${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`,
  );
  process.exitCode = erreurs.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Sondes négatives.
// ---------------------------------------------------------------------------

/**
 * @type {{ nom: string, fichier: string, abimer?: (texte: string) => string,
 *          illisible?: boolean, jour?: string, attendu: RegExp }[]}
 */
const SONDES = [
  {
    nom: 'un contrôle requis ajouté sans régénérer la doc',
    fichier: RELEVE,
    abimer: (texte) =>
      texte.replace('"mutation-delta"', '"mutation-delta",\n    "porte-neuve"'),
    attendu: /DIVERGE de ce que produit le relevé/,
  },
  {
    nom: 'la liste de la doc rognée à la main',
    fichier: DOCUMENT,
    abimer: (texte) => texte.replace('`mutation-delta`.', '.'),
    attendu: /DIVERGE de ce que produit le relevé/,
  },
  {
    nom: 'bloc engendré supprimé',
    fichier: DOCUMENT,
    abimer: (texte) => texte.replace(DEBUT, '<!-- parti -->'),
    attendu: /le bloc engendré est absent/,
  },
  {
    nom: 'relevé vidé de ses contrôles',
    fichier: RELEVE,
    abimer: (texte) =>
      texte.replace(/"controles": \[[^\]]*\]/, '"controles": []'),
    attendu: /relevé incomplet ou mal formé/,
  },
  {
    nom: 'relevé illisible',
    fichier: RELEVE,
    illisible: true,
    attendu: /relevé illisible/,
  },
  {
    nom: 'une seconde phrase qui recopie la liste',
    fichier: DOCUMENT,
    abimer: (texte) =>
      `${texte}\n\n- Contrôles **requis** : \`ci\` et \`config-validation\`.\n`,
    attendu: /seconde phrase énonce les contrôles requis/,
  },
];

if (process.argv.includes('--relever')) {
  process.exitCode = await relever();
} else if (process.argv.includes('--ecrire')) {
  process.exitCode = ecrire();
} else if (process.argv.includes('--autotest')) {
  process.exitCode = autotest();
} else {
  console.log('Contrôles requis — la doc vs le relevé engendré');
  conclure(executer());
}

/** Rejoue les sondes ; rend 0 si toutes mordent et si le témoin est vert. */
function autotest() {
  const surDisque = lecteur;
  let echecs = 0;

  executer();
  if (erreurs.length > 0) {
    console.error(
      `❌ témoin : l’état réel lève déjà ${erreurs.length} constat(s) — les sondes ne prouveraient rien.`,
    );
    for (const { portee, message } of erreurs) {
      console.error(`   ${portee} — ${message}`);
    }
    echecs += 1;
  }

  for (const sonde of SONDES) {
    const origine = surDisque(sonde.fichier);
    if (origine === null) {
      console.error(
        `❌ sonde « ${sonde.nom} » : ${sonde.fichier} illisible — la sonde a perdu sa cible.`,
      );
      echecs += 1;
      continue;
    }

    if (sonde.illisible === true) {
      lecteur = (relatif) =>
        relatif === sonde.fichier ? null : surDisque(relatif);
    } else if (sonde.abimer !== undefined) {
      const abime = sonde.abimer(origine);
      if (abime === origine) {
        console.error(
          `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la ligne visée a bougé.`,
        );
        echecs += 1;
        continue;
      }
      lecteur = (relatif) =>
        relatif === sonde.fichier ? abime : surDisque(relatif);
    }

    executer();
    lecteur = surDisque;

    if (erreurs.some((constat) => sonde.attendu.test(constat.message))) {
      console.log(`✅ sonde « ${sonde.nom} » — la porte mord.`);
    } else {
      console.error(
        `❌ sonde « ${sonde.nom} » : aucun constat attendu — la porte ne mord pas.`,
      );
      echecs += 1;
    }
  }

  console.log(`\n${SONDES.length} sonde(s) rejouée(s), ${echecs} échec(s).`);
  return echecs === 0 ? 0 : 1;
}
