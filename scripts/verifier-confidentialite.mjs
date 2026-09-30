#!/usr/bin/env node
// @ts-check
/**
 * Porte de **confidentialité du dépôt public** (`pnpm confidentialite`).
 *
 * ## Pourquoi ce script existe
 *
 * Du 2026-08-02 au 2026-09-29, le dépôt — **public** — a versionné
 * `.claude/memory/`, dont une fiche décrivant l'accès au serveur de production.
 * Le même jour, l'inventaire a trouvé ailleurs : la cible SSH du serveur en
 * valeur par défaut de trois scripts, l'adresse professionnelle d'une employée
 * de la crèche dans un test, le prénom d'un enfant réel dans des fixtures,
 * l'identifiant d'un contrat de production. `CLAUDE.md` l'interdisait en prose ;
 * rien ne le tenait.
 *
 * Les gardes existantes ne pouvaient pas le voir, et ce n'est pas un défaut de
 * réglage : **gitleaks** (job `secret-scan`) cherche des **secrets** — des
 * chaînes à forte entropie ou de forme connue. Une adresse, un prénom, une IP
 * privée, un chemin ne sont pas des secrets : ce sont des **renseignements**.
 *
 * ## Ce que la porte garantit — sur les fichiers suivis (l'index, `git add -f` compris)
 *
 * 1. **mémoire** : aucun fichier sous `.claude/memory/` ;
 * 2. **cible SSH** : aucune `utilisateur@<IPv4 privée ou tailnet>`, aucun
 *    `ssh … utilisateur@hôte` à hôte écrit en clair (forme générique :
 *    `<utilisateur>@<ip-lan>`) ;
 * 3. **e-mail** : toute adresse est sur un domaine **réservé** (RFC 2606/6761 :
 *    `example.com|org|net`, `*.example`, `*.test`, `*.invalid`, `*.localhost`)
 *    ou dans `EXCEPTIONS_EMAIL` — minimale et motivée ligne à ligne ;
 *    seule exception limitée à un contexte : la signature de Dependabot, admise
 *    dans un message de commit, sur sa ligne exacte (`SIGNATURE_DEPENDABOT`) ;
 * 4. **chemin personnel** : aucun `/home/<nom>/` ni `C:\Users\<nom>\` hors
 *    comptes génériques (`runner`, `node`…) et formes `<…>` ;
 * 5. **valeurs privées** : aucune des valeurs de la liste **privée** (IP du
 *    serveur, prénoms réels, identifiants de production…). Cette liste ne vit
 *    **jamais** dans le dépôt, même hachée : l'empreinte d'un prénom ou d'une IP
 *    privée se retrouve par dictionnaire, et la publier dirait « ceci est un vrai
 *    enfant ». Elle se lit dans `CRECHE_MOTIFS_INTERDITS` (secret de CI, une
 *    valeur par ligne) ou dans le fichier `CRECHE_MOTIFS_INTERDITS_FICHIER`
 *    (défaut `~/.config/creche-planner/motifs-interdits.txt`). Absente, la règle
 *    est **annoncée comme non jouée**, jamais réputée verte. Une valeur qui est
 *    aussi un mot courant se compare **en respectant la casse** (préfixe `=`).
 *
 * Les mêmes règles 2 à 5 jugent aussi un **texte** : message de commit
 * (`--message <fichier>`, hook `commit-msg`), commits d'une plage
 * (`--commits <base>..<tête>`, CI), titre et description de PR
 * (`--texte-env <VAR>…`, CI).
 *
 * ## Ce qu'elle ne couvre pas
 *
 * Une IP privée **seule** sans liste privée, un nom propre quelconque (un prénom
 * n'est reconnu que s'il est dans la liste privée), une phrase qui décrit la
 * posture de sécurité, une capture d'écran, un binaire. Les **issues** et
 * **commentaires** (aucun déclencheur ne peut les bloquer). Et l'**historique** :
 * la porte juge l'arbre et les textes à venir, pas le passé.
 *
 * Usage :
 *   pnpm confidentialite                       # juge l'index courant
 *   pnpm confidentialite --message <fichier>   # un message de commit
 *   pnpm confidentialite --commits a..b        # les messages d'une plage
 *   pnpm confidentialite --texte-env VAR…      # des textes passés par l'environnement
 *   pnpm confidentialite --autotest            # rejoue les sondes négatives
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const PREFIXE_INTERDIT = '.claude/memory/';

/** Fichiers générés dont les adresses appartiennent à des tiers publics (auteurs de paquets). */
const FICHIERS_EXEMPTS_EMAIL = new Set(['pnpm-lock.yaml']);

/**
 * Adresses admises hors domaine réservé. Chaque entrée dit POURQUOI.
 * `empreinte` = SHA-256 de l'adresse en minuscules (l'adresse n'est pas écrite ici).
 */
const EXCEPTIONS_EMAIL = [
  {
    domaine: 'users.noreply.github.com',
    raison: 'adresses git « noreply » de GitHub, dont celle du propriétaire',
  },
  {
    adresse: 'noreply@anthropic.com',
    raison:
      'trailer « Co-Authored-By » des commits assistés — adresse sans boîte',
  },
  {
    adresse: 'git@github.com',
    raison: 'utilisateur SSH générique de GitHub, pas une personne',
  },
  {
    empreinte:
      'b6ee735e80e3bf27a43ac67f16289c9528947049995ed5bb0b1cdeb66a1d04d0',
    raison:
      'adresse personnelle du propriétaire, expéditeur/destinataire des alertes (alertmanager, veille CVE) — sa propre donnée, déjà publique dans ses commits',
  },
];

/**
 * Exception ÉTROITE — décision du propriétaire du 2026-09-30. Chaque commit de
 * Dependabot se termine par `Signed-off-by: dependabot[bot] <…@github.com>`,
 * l'adresse de support générique de GitHub : sans elle, toute PR Dependabot est
 * rouge depuis l'arrivée de cette porte. Elle n'est admise QUE :
 *   - dans un MESSAGE DE COMMIT (`--message`, `--commits`) — jamais dans un
 *     fichier suivi, ni dans un titre ou une description de PR ;
 *   - sur une ligne qui est EXACTEMENT ce trailer, au nom `dependabot[bot]`.
 * Partout ailleurs, la même adresse reste refusée : c'est ce que les sondes
 * « exception Dependabot » de l'autotest vérifient. L'adresse n'est pas écrite
 * ici (empreinte SHA-256, en minuscules) : ce fichier est lui-même jugé.
 */
const SIGNATURE_DEPENDABOT = {
  ligne: /^Signed-off-by: dependabot\[bot\] <([^<>\s]+)>$/,
  empreinte: '1c939d069387dc23bf4d3c19babd3b32cc05e079801ce2d8e2417a839b77e8ce',
};

/** La ligne est-elle exactement le trailer de signature de Dependabot ? */
function estSignatureDependabot(/** @type {string} */ ligne) {
  const m = SIGNATURE_DEPENDABOT.ligne.exec(ligne.trimEnd());
  return (
    m !== null &&
    sha256((m[1] ?? '').toLowerCase()) === SIGNATURE_DEPENDABOT.empreinte
  );
}

/** IPv4 privées (RFC 1918) et plage CGNAT des tailnets (100.64.0.0/10). */
const IP_PRIVEE = String.raw`(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}`;
const RE_UTILISATEUR_IP = new RegExp(
  String.raw`(?<![\w.-])[a-z_][a-z0-9_-]{0,31}@${IP_PRIVEE}(?![\d])`,
  'g',
);
/** `ssh [options] utilisateur@hôte` — options courtes/longues, avec ou sans valeur. */
const RE_SSH =
  /\bssh(?:\.exe)?(?:\s+-{1,2}[A-Za-z][^\s]*(?:\s+[^\s-][^\s]*)?)*\s+([a-z_][a-z0-9_-]{0,31})@([A-Za-z0-9][A-Za-z0-9.-]*)/g;
const HOTE_GENERIQUE =
  /^(localhost|example\b|host\b|hote\b|serveur\b|server\b|github\.com$)/;

/** La partie locale commence par un alphanumérique : `${VAR:-a@b.c}` ne capture pas le `-`. */
const RE_EMAIL =
  /(?<![\w.%+])[A-Za-z0-9][A-Za-z0-9._%+-]*@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![\w-])/g;
/** Un « domaine » qui est en fait un nom de fichier (`logo@2x.png`). */
const PSEUDO_DOMAINE =
  /\.(png|svg|jpe?g|webp|gif|js|mjs|cjs|ts|tsx|css|json|md|ya?ml)$/i;
const DOMAINE_RESERVE =
  /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;

const RE_CHEMIN_PERSO =
  /(?:\/home\/|\/Users\/|[A-Za-z]:\\{1,2}Users\\{1,2})([A-Za-z0-9._-]+)/g;
const COMPTES_GENERIQUES = new Set([
  'runner',
  'node',
  'user',
  'utilisateur',
  'ubuntu',
  'vscode',
  'public',
  'default',
  'shared',
]);

const sha256 = (/** @type {string} */ s) =>
  createHash('sha256').update(s).digest('hex');

function emailAdmise(
  /** @type {string} */ adresse,
  /** @type {string} */ domaine,
) {
  const a = adresse.toLowerCase();
  const d = domaine.toLowerCase();
  if (DOMAINE_RESERVE.test(d)) return true;
  return EXCEPTIONS_EMAIL.some(
    (e) =>
      (e.domaine && (d === e.domaine || d.endsWith(`.${e.domaine}`))) ||
      (e.adresse && a === e.adresse) ||
      (e.empreinte && sha256(a) === e.empreinte),
  );
}

/**
 * Motif privé → expression. `=Valeur` : comparaison SENSIBLE à la casse (pour
 * une valeur qui est aussi un mot courant) ; sinon insensible. Toujours sur
 * mots entiers.
 */
function versRegex(/** @type {string} */ motif) {
  const sensible = motif.startsWith('=');
  const v = sensible ? motif.slice(1) : motif;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`,
    sensible ? 'u' : 'iu',
  );
}

/**
 * Juge un texte, ligne à ligne. Retourne des constats SANS la valeur fautive :
 * un rapport de porte ne doit pas republier ce qu'il signale.
 *
 * @param {string} ou  désignation (fichier, « message de commit »…)
 * @param {string} texte
 * @param {{ emails: boolean, motifsPrives: string[], signatureDependabot?: boolean }} options
 *   `signatureDependabot` : vrai pour un MESSAGE DE COMMIT seulement (cf.
 *   `SIGNATURE_DEPENDABOT`) — jamais pour un fichier ni un texte de PR.
 */
export function jugerTexte(
  ou,
  texte,
  { emails, motifsPrives, signatureDependabot = false },
) {
  /** @type {string[]} */
  const constats = [];
  const regexPrivees = motifsPrives.map(versRegex);
  texte.split(/\r?\n/).forEach((ligne, i) => {
    const lieu = `${ou}:${i + 1}`;
    if (
      [...ligne.matchAll(RE_UTILISATEUR_IP)].length > 0 ||
      [...ligne.matchAll(RE_SSH)].some((m) => !HOTE_GENERIQUE.test(m[2] ?? ''))
    ) {
      constats.push(
        `${lieu} : cible SSH littérale — écrire \`<utilisateur>@<ip-lan>\`, ou lire la cible dans \`CRECHE_SSH_TARGET\`.`,
      );
    }
    if (emails && !(signatureDependabot && estSignatureDependabot(ligne))) {
      for (const m of ligne.matchAll(RE_EMAIL)) {
        const domaine = m[1] ?? '';
        if (PSEUDO_DOMAINE.test(domaine) || emailAdmise(m[0], domaine))
          continue;
        constats.push(
          `${lieu} : adresse e-mail sur un domaine non réservé (\`…@${domaine}\`) — une valeur de test s'écrit sur \`example.com\`, \`*.example\`, \`*.test\` ou \`*.invalid\`.`,
        );
      }
    }
    for (const m of ligne.matchAll(RE_CHEMIN_PERSO)) {
      const nom = m[1] ?? '';
      if (COMPTES_GENERIQUES.has(nom.toLowerCase())) continue;
      constats.push(
        `${lieu} : chemin personnel nommant un compte (${nom.length} car.) — écrire \`~/…\` ou \`<utilisateur>\`.`,
      );
    }
    // Aussi sans antislashs : une IP écrite dans une regex (`192\.168\…`)
    // échappait à la comparaison (mesuré : un test la portait ainsi).
    const sansEchappement = ligne.replace(/\\/g, '');
    regexPrivees.forEach((re, k) => {
      if (re.test(ligne) || re.test(sansEchappement)) {
        constats.push(
          `${lieu} : valeur de la liste privée n°${k + 1} (liste hors dépôt) — la retirer.`,
        );
      }
    });
  });
  return constats;
}

/**
 * @param {{ chemin: string, texte: string }[]} fichiers
 * @param {string[]} motifsPrives
 * @returns {string[]} constats (vide = vert)
 */
export function verifier(fichiers, motifsPrives) {
  /** @type {string[]} */
  const constats = [];
  for (const { chemin, texte } of fichiers) {
    if (chemin.startsWith(PREFIXE_INTERDIT)) {
      constats.push(
        `${chemin} : fichier suivi sous \`${PREFIXE_INTERDIT}\` — la mémoire de travail ne se versionne pas (dépôt public). \`git rm --cached\` le retire du suivi sans le détruire.`,
      );
      continue;
    }
    constats.push(
      ...jugerTexte(chemin, texte, {
        emails: !FICHIERS_EXEMPTS_EMAIL.has(chemin),
        motifsPrives,
      }),
    );
  }
  return constats;
}

/** Liste privée : secret de CI, ou fichier du poste. `null` = absente. */
function lireMotifsPrives() {
  const brut =
    process.env['CRECHE_MOTIFS_INTERDITS'] ??
    (() => {
      const fichier =
        process.env['CRECHE_MOTIFS_INTERDITS_FICHIER'] ??
        path.join(
          homedir(),
          '.config',
          'creche-planner',
          'motifs-interdits.txt',
        );
      try {
        return readFileSync(fichier, 'utf8');
      } catch {
        return null;
      }
    })();
  if (brut == null || brut.trim() === '') return null;
  return brut
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

function lireIndex() {
  const chemins = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  /** @type {{ chemin: string, texte: string }[]} */
  const fichiers = [];
  for (const chemin of chemins) {
    if (chemin.startsWith(PREFIXE_INTERDIT)) {
      fichiers.push({ chemin, texte: '' });
      continue;
    }
    let texte;
    try {
      texte = readFileSync(chemin, 'utf8');
    } catch {
      continue; // supprimé du disque mais encore indexé : rien à lire
    }
    if (texte.includes('\0')) continue; // binaire
    fichiers.push({ chemin, texte });
  }
  return fichiers;
}

/**
 * Sondes négatives : chaque mutation DOIT faire rougir la porte. Valeurs
 * fictives, ASSEMBLÉES à l'exécution : écrites d'un bloc, la porte les
 * compterait sur ce fichier même (mesuré : elle a refusé le commit qui les
 * posait en clair).
 */
function autotest() {
  const at = (/** @type {string} */ u, /** @type {string} */ h) => `${u}@${h}`;
  const opts = {
    emails: true,
    motifsPrives: ['Prenomfictif', '10.9.8.7', '=Motcourant'],
  };
  const sain = [
    'ssh <utilisateur>@<ip-lan> ; ssh user@localhost',
    `contact : ${at('parent', 'example.com')}, ${at('a', 'creche.example')}, ${at('b', 'x.test')}`,
    `${at('12345+moi', 'users.noreply.github.com')} ; logo${at('', '2x.png')}`,
    '~/creche-planner ; /home/runner/work ; C:\\Users\\<poste>',
    'Prenomfictifs ne compte pas (mot différent) ; 10.9.8.70 non plus',
    'un motcourant en minuscules ne compte pas (valeur sensible à la casse)',
  ].join('\n');
  const sondes = [
    [
      'cible SSH utilisateur@IP RFC 1918',
      `SERVER="${at('alice', '10.20.30.40')}"`,
    ],
    ['cible SSH utilisateur@IP tailnet', `via ${at('bob', '100.101.102.103')}`],
    [
      'ssh avec options et hôte en clair',
      `ssh -L 1:x:1 -i k ${at('carol', 'prod-box.lan')}`,
    ],
    [
      'e-mail sur domaine réel',
      `to: ${at('jeanne.d', 'association-reelle.fr')}`,
    ],
    ['e-mail sur domaine « de test » non réservé', at('parent', 'test.fr')],
    [
      'adresse derrière une valeur par défaut',
      `\${X:-${at('jeanne', 'association-reelle.fr')}}`,
    ],
    [
      'chemin /home/<compte>',
      `cd ${['/home', 'dupont', 'creche-planner'].join('/')}`,
    ],
    [
      'chemin Windows C:\\Users\\<compte>',
      ['C:', 'Users', 'dupont', 'projets'].join('\\'),
    ],
    [
      'valeur privée (mot, insensible à la casse)',
      'enfant: \x27PRENOMFICTIF\x27',
    ],
    ['valeur privée (IP)', 'NOTIF_APP_URL=https://10.9.8.7/'],
    [
      'valeur privée échappée dans une regex',
      String.raw`toThrow(/https:\/\/10\.9\.8\.7/u)`,
    ],
    ['valeur privée sensible à la casse', 'enfant: \x27Motcourant\x27'],
  ];
  let echecs = 0;
  const temoin = jugerTexte('témoin', sain, opts);
  if (temoin.length > 0) {
    console.error(
      `✖ témoin rouge — la porte mord à vide :\n  ${temoin.join('\n  ')}`,
    );
    echecs++;
  }
  for (const [nom, texte] of sondes) {
    const mord = jugerTexte('sonde', `${sain}\n${texte}`, opts).length > 0;
    console.log(`${mord ? '✔' : '✖'} sonde « ${nom} »`);
    if (!mord) echecs++;
  }
  const memoire = verifier([{ chemin: '.claude/memory/x.md', texte: '' }], []);
  console.log(
    `${memoire.length > 0 ? '✔' : '✖'} sonde « fiche mémoire suivie »`,
  );
  if (memoire.length === 0) echecs++;
  const lock = verifier(
    [{ chemin: 'pnpm-lock.yaml', texte: at('auteur', 'paquet.dev') }],
    [],
  );
  if (lock.length > 0) {
    console.error(
      '✖ témoin : une adresse d’auteur de paquet dans le lockfile est jugée rouge.',
    );
    echecs++;
  }

  // Exception Dependabot : admise sur SA ligne, dans un message de commit, et
  // nulle part ailleurs. Les sondes négatives font rougir l'autotest si
  // l'exception s'élargit — c'est ce qui la distingue d'un trou.
  const adresseDependabot = at('support', 'github.com');
  const signature = `Signed-off-by: dependabot[bot] <${adresseDependabot}>`;
  const commit = { emails: true, motifsPrives: [], signatureDependabot: true };
  const temoinSignature = jugerTexte(
    'témoin',
    `chore(deps): bump x\n\n${signature}`,
    commit,
  );
  if (temoinSignature.length > 0) {
    console.error(
      '✖ témoin : la signature Dependabot d’un message de commit est jugée rouge — l’exception ne joue pas.',
    );
    echecs++;
  }
  /** @type {[string, boolean][]} nom, la porte a-t-elle mordu ? */
  const sondesSignature = [
    [
      'exception Dependabot : même ligne dans un FICHIER suivi',
      verifier([{ chemin: 'docs/x.md', texte: signature }], []).length > 0,
    ],
    [
      'exception Dependabot : même ligne dans un TEXTE DE PR',
      jugerTexte('PR_CORPS', signature, { emails: true, motifsPrives: [] })
        .length > 0,
    ],
    [
      'exception Dependabot : même adresse ailleurs dans le message',
      jugerTexte('commit', `contact : ${adresseDependabot}`, commit).length > 0,
    ],
    [
      'exception Dependabot : autre signataire, même adresse',
      jugerTexte(
        'commit',
        `Signed-off-by: quelqu-un <${adresseDependabot}>`,
        commit,
      ).length > 0,
    ],
    [
      'exception Dependabot : dependabot[bot], autre adresse',
      jugerTexte(
        'commit',
        `Signed-off-by: dependabot[bot] <${at('autre', 'github.com')}>`,
        commit,
      ).length > 0,
    ],
    [
      'exception Dependabot : texte ajouté après le trailer',
      jugerTexte('commit', `${signature} ${at('x', 'reel.fr')}`, commit)
        .length > 0,
    ],
  ];
  for (const [nom, mord] of sondesSignature) {
    console.log(`${mord ? '✔' : '✖'} sonde « ${nom} »`);
    if (!mord) echecs++;
  }
  process.exit(echecs > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes('--autotest')) autotest();

const motifs = lireMotifsPrives();
const motifsPrives = motifs ?? [];
/** @type {string[]} */
let constats = [];
let objet = '';

const pos = (/** @type {string} */ opt) => argv.indexOf(opt);
if (pos('--message') >= 0) {
  const fichier = argv[pos('--message') + 1] ?? '';
  constats = jugerTexte(
    'message de commit',
    readFileSync(fichier, 'utf8').replace(/^#.*$/gm, ''),
    { emails: true, motifsPrives, signatureDependabot: true },
  );
  objet = 'message de commit';
} else if (pos('--commits') >= 0) {
  const plage = argv[pos('--commits') + 1] ?? '';
  const brut = execFileSync('git', ['log', '--format=%h%x00%B%x01', plage], {
    encoding: 'utf8',
  });
  const messages = brut.split('\x01').filter((m) => m.trim());
  for (const m of messages) {
    const [h, corps] = m.split('\x00');
    constats.push(
      ...jugerTexte(`commit ${(h ?? '').trim()}`, corps ?? '', {
        emails: true,
        motifsPrives,
        signatureDependabot: true,
      }),
    );
  }
  objet = `${messages.length} message(s) de commit (${plage})`;
} else if (pos('--texte-env') >= 0) {
  const vars = argv
    .slice(pos('--texte-env') + 1)
    .filter((a) => !a.startsWith('--'));
  for (const v of vars) {
    constats.push(
      ...jugerTexte(v, process.env[v] ?? '', { emails: true, motifsPrives }),
    );
  }
  objet = vars.join(', ');
} else {
  constats = verifier(lireIndex(), motifsPrives);
  objet = 'fichiers suivis';
}

if (motifs === null) {
  console.log(
    'ℹ Liste privée ABSENTE (CRECHE_MOTIFS_INTERDITS / ~/.config/creche-planner/motifs-interdits.txt) : la règle 5 n’est PAS jouée.',
  );
}
if (constats.length > 0) {
  console.error(`✖ Confidentialité du dépôt public — ${objet} :\n`);
  for (const c of constats) console.error(`- ${c}`);
  console.error(
    '\nNe pas contourner (pas de --no-verify) : retirer la valeur. Règles et exceptions : scripts/verifier-confidentialite.mjs.',
  );
  process.exit(1);
}
console.log(
  `✔ Confidentialité (${objet}) : mémoire hors dépôt, aucune cible SSH, e-mails sur domaines réservés, aucun chemin personnel${motifs ? `, ${motifs.length} valeur(s) privée(s) absentes` : ''}.`,
);
