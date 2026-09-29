#!/usr/bin/env node
// @ts-check
/**
 * Porte de **confidentialité du dépôt public** (`pnpm confidentialite`).
 *
 * ## Pourquoi ce script existe
 *
 * Du 2026-08-02 au 2026-09-29, le dépôt — **public** — a versionné
 * `.claude/memory/`, dont une fiche décrivant l'accès au serveur de production :
 * cible SSH (utilisateur@IP), emplacement de la clé et des secrets, posture
 * `sudo`. `CLAUDE.md` l'interdisait en prose (« les fiches décrivant l'accès au
 * serveur restent hors du dépôt »), mais c'était une règle de **contenu**,
 * confiée au jugement de chaque session, sans aucun outil pour la tenir.
 *
 * Les deux gardes existantes ne pouvaient pas la voir, et ce n'est pas un
 * défaut de réglage : **gitleaks** (job `secret-scan`) cherche des **secrets** —
 * des chaînes à forte entropie ou de forme connue (clés privées, jetons
 * GitHub/AWS…). Un nom d'utilisateur, une IP privée, un chemin de fichier ou une
 * phrase sur la politique `sudo` ne sont pas des secrets : ce sont des
 * **renseignements**. Aucune règle d'entropie ne les attrapera jamais. Il fallait
 * une porte sur le **chemin** et sur la **forme** d'un identifiant de connexion.
 *
 * ## Ce que la porte garantit
 *
 * Sur les fichiers **suivis** (`git ls-files` : l'index, donc aussi ce qui vient
 * d'être indexé, `git add -f` compris) :
 *
 * 1. aucun fichier sous `.claude/memory/` — le `.gitignore` ne suffit pas, un
 *    `git add -f` le traverse ;
 * 2. les **cibles SSH littérales** — `utilisateur@<IPv4 privée ou tailnet>`, ou
 *    `ssh … utilisateur@hôte` avec un hôte écrit en clair — ne dépassent pas
 *    `PLAFOND_CIBLES_SSH`. C'est un **cliquet** : le plafond est le compte
 *    mesuré le jour de la pose (des scripts de déploiement portent encore la
 *    cible en valeur par défaut, leur retouche est un geste du propriétaire), il
 *    refuse toute occurrence **nouvelle**, et il échoue aussi quand le compte
 *    **baisse** sans que le plafond suive — il ne peut que descendre, jusqu'à 0.
 *    Les formes génériques (`<utilisateur>@<ip-lan>`, `user@localhost`,
 *    `…@example.org`) ne comptent pas.
 *
 * ## Ce qu'elle ne couvre pas
 *
 * Une IP privée **seule**, un nom d'hôte seul, un chemin système, une phrase de
 * prose qui décrit la posture de sécurité : trop de formes légitimes (règles de
 * pare-feu, tests de validation d'URL) pour une règle sans faux positifs. Et
 * l'**historique** : la porte juge l'arbre, pas les commits passés.
 *
 * Usage :
 *   pnpm confidentialite              # juge l'index courant
 *   pnpm confidentialite --autotest   # rejoue les sondes négatives
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Compte mesuré le 2026-09-29. Ne peut que baisser ; cible : 0. */
const PLAFOND_CIBLES_SSH = 11;

const PREFIXE_INTERDIT = '.claude/memory/';

/** IPv4 privées (RFC 1918) et plage CGNAT des tailnets (100.64.0.0/10). */
const IP_PRIVEE = String.raw`(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}`;
const RE_UTILISATEUR_IP = new RegExp(
  String.raw`(?<![\w.-])[a-z_][a-z0-9_-]{0,31}@${IP_PRIVEE}(?![\d])`,
  'g',
);
/** `ssh [options] utilisateur@hôte` — options courtes/longues, avec ou sans valeur. */
const RE_SSH =
  /\bssh(?:\.exe)?(?:\s+-{1,2}[A-Za-z][^\s]*(?:\s+[^\s-][^\s]*)?)*\s+([a-z_][a-z0-9_-]{0,31})@([A-Za-z0-9][A-Za-z0-9.-]*)/g;
/** Hôtes génériques : une doc peut les écrire sans rien révéler. */
const HOTE_GENERIQUE =
  /^(localhost|example\b|host\b|hote\b|serveur\b|server\b)/;

/**
 * @param {{ chemin: string, texte: string }[]} fichiers
 * @param {number} plafond
 * @returns {string[]} constats (vide = vert)
 */
export function verifier(fichiers, plafond) {
  /** @type {string[]} */
  const constats = [];
  /** @type {Set<string>} */
  const lignesCibles = new Set();

  for (const { chemin, texte } of fichiers) {
    if (chemin.startsWith(PREFIXE_INTERDIT)) {
      constats.push(
        `${chemin} : fichier suivi sous \`${PREFIXE_INTERDIT}\` — la mémoire de travail ne se versionne pas (dépôt public). \`git rm --cached\` le retire du suivi sans le détruire.`,
      );
      continue;
    }
    texte.split(/\r?\n/).forEach((ligne, i) => {
      const trouve =
        [...ligne.matchAll(RE_UTILISATEUR_IP)].length > 0 ||
        [...ligne.matchAll(RE_SSH)].some(
          (m) => !HOTE_GENERIQUE.test(m[2] ?? ''),
        );
      if (trouve) lignesCibles.add(`${chemin}:${i + 1}`);
    });
  }

  const n = lignesCibles.size;
  if (n > plafond) {
    constats.push(
      `${n} ligne(s) portent une cible SSH littérale, pour un plafond de ${plafond} — une occurrence NOUVELLE a été ajoutée. Écrire la forme générique \`<utilisateur>@<ip-lan>\`, ou lire la cible d'une variable d'environnement hors dépôt. Lignes :\n  ${[...lignesCibles].join('\n  ')}`,
    );
  } else if (n < plafond) {
    constats.push(
      `${n} ligne(s) portent une cible SSH littérale, sous le plafond de ${plafond} : abaisser \`PLAFOND_CIBLES_SSH\` à ${n} dans ce script (le cliquet ne peut que descendre).`,
    );
  }
  return constats;
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
 * fictives uniquement — une sonde ne recopie jamais une vraie cible.
 */
function autotest() {
  // Assemblées à l'exécution : écrites d'un bloc, ces cibles FICTIVES seraient
  // comptées par la porte elle-même sur ce fichier (mesuré : elle a refusé le
  // commit qui les posait en clair).
  const at = (/** @type {string} */ u, /** @type {string} */ h) => `${u}@${h}`;
  const sain = [
    { chemin: 'docs/x.md', texte: '`ssh <utilisateur>@<ip-lan>`\n' },
  ];
  const sondes = [
    {
      nom: 'fiche mémoire suivie',
      fichiers: [...sain, { chemin: '.claude/memory/acces.md', texte: '' }],
      plafond: 0,
    },
    {
      nom: 'utilisateur@IP RFC 1918',
      fichiers: [
        ...sain,
        { chemin: 'a.sh', texte: `SERVER="${at('alice', '10.20.30.40')}"` },
      ],
      plafond: 0,
    },
    {
      nom: 'utilisateur@IP tailnet',
      fichiers: [
        ...sain,
        { chemin: 'a.md', texte: `via ${at('bob', '100.101.102.103')}` },
      ],
      plafond: 0,
    },
    {
      nom: 'ssh avec options et hôte en clair',
      fichiers: [
        ...sain,
        {
          chemin: 'a.md',
          texte: `ssh -L 4210:x:4210 -i k ${at('carol', 'prod-box.lan')}`,
        },
      ],
      plafond: 0,
    },
    {
      nom: 'cliquet qui baisse sans que le plafond suive',
      fichiers: sain,
      plafond: 1,
    },
  ];
  let echecs = 0;
  if (verifier(sain, 0).length > 0) {
    console.error(
      '✖ témoin : l’arbre sain est jugé rouge — la porte mord à vide.',
    );
    echecs++;
  }
  for (const s of sondes) {
    const mord = verifier(s.fichiers, s.plafond).length > 0;
    console.log(`${mord ? '✔' : '✖'} sonde « ${s.nom} »`);
    if (!mord) echecs++;
  }
  const generiques = [
    { chemin: 'a.md', texte: 'ssh user@localhost ; ssh me@example.org' },
  ];
  if (verifier(generiques, 0).length > 0) {
    console.error('✖ témoin : une forme générique est jugée rouge.');
    echecs++;
  }
  process.exit(echecs > 0 ? 1 : 0);
}

if (process.argv.includes('--autotest')) autotest();

const constats = verifier(lireIndex(), PLAFOND_CIBLES_SSH);
if (constats.length > 0) {
  console.error('✖ Confidentialité du dépôt public :\n');
  for (const c of constats) console.error(`- ${c}\n`);
  process.exit(1);
}
console.log(
  `✔ Confidentialité : rien sous ${PREFIXE_INTERDIT}, cibles SSH littérales au plafond (${PLAFOND_CIBLES_SSH}).`,
);
