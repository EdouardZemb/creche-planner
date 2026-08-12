#!/usr/bin/env node
// @ts-check
/**
 * Porte des empêchements d'outillage : la liste « Encore réels » de
 * `CONTRIBUTING.md` et la famille `EM-xx` de `docs/34-registre-ameliorations.md`
 * §6 doivent se répondre.
 *
 * ## Pourquoi ce script existe
 *
 * Le dépôt tenait déjà la liste de ses frictions d'atelier — la section
 * « Encore réels — à connaître, aucun outil ne les couvre » de CONTRIBUTING.
 * Le défaut n'était pas de ne pas les noter : c'était de les noter **comme une
 * fatalité, jamais comme un backlog**. Aucune n'avait de remède planifié ni de
 * critère de sortie, et leur nombre ne pouvait que croître — exactement le mode
 * de défaillance que le registre d'améliorations a été créé pour tuer côté
 * produit, et qui survivait intact côté atelier.
 *
 * Une liste sans porte se rallonge d'une ligne à chaque lot, et personne ne
 * s'en aperçoit : c'est ce qui est arrivé aux tableaux `AQ-xx`/`AUD-xx`. Ce
 * script rend l'écart opposable.
 *
 * ## Ce que la porte garantit
 *
 *   1. **Couverture** : chaque entrée de la liste cite un `EM-xx`, et un seul.
 *   2. **Existence** : le `EM-xx` cité est une ligne réelle du §6.
 *   3. **Unicité** : deux entrées ne peuvent pas se partager la même ligne —
 *      un empêchement par piège, sinon la file ment sur sa taille.
 *   4. **Suite donnée** : une ligne encore listée porte un **critère de sortie**
 *      si elle est ouverte, ou un renoncement **daté** si elle est `⛔`.
 *   5. **Anti-péremption** : une ligne `✅` (remède livré) ne peut pas rester
 *      dans la liste des pièges « encore réels » — la liste doit maigrir quand
 *      l'atelier progresse, sinon elle redevient de la prose.
 *
 * L'attendu est **dérivé du fichier** : la liste des pièges n'est recopiée
 * nulle part ici. Ajouter une entrée à CONTRIBUTING sans ouvrir de ligne au
 * registre échoue ; retirer une entrée n'exige rien (la ligne du registre lui
 * survit, avec son statut).
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - La **valeur** du remède : « sharder le lint » est un critère de sortie
 *    recevable pour la forme, sa pertinence est du ressort de la revue.
 *  - L'**exhaustivité** : un empêchement subi mais jamais écrit reste invisible.
 *    Aucune machine ne peut constater ce que personne n'a consigné — c'est le
 *    rôle du rituel (doc 34 §7, gabarit de PR).
 *  - La **forme** des lignes `EM-xx` elles-mêmes (identifiants contigus, statut
 *    connu, ligne close avec preuve) : c'est `pnpm registre`, qui traite la
 *    famille `EM` comme les autres.
 *
 * ## Usage
 *   pnpm empechements              # vérifie (exit 1 si un constat)
 *   pnpm empechements --autotest   # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : une section introuvable ou vide ÉCHOUE
 *    au lieu de rendre « rien à signaler » (un balayage à vide est
 *    indiscernable d'un succès).
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture : ce couple est la fenêtre TOCTOU que la règle CodeQL
 *    `js/file-system-race` (bloquante en CI) refuse.
 *  - Aucune sonde ne vise un **littéral mutable** (un identifiant précis, un
 *    statut, un compteur) : trois sondes du registre ont cessé de mordre pour
 *    cette raison exacte (`LE-22`, `LE-33`). Toutes les cibles ci-dessous sont
 *    calculées depuis les documents du jour.
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const CONTRIBUTING = 'CONTRIBUTING.md';
const REGISTRE = 'docs/34-registre-ameliorations.md';

/**
 * Le titre de la liste héritée, dans CONTRIBUTING. C'est la seule chaîne de ce
 * script qui désigne du contenu : si elle disparaît, la porte ÉCHOUE (constat
 * `section-vide`) au lieu de balayer le vide.
 */
const MARQUEUR_LISTE = 'Encore réels';

/** Titre de la section du registre qui porte la famille. Même contrat. */
const TITRE_SECTION_EM = /^## \d+\. Empêchements/m;

const STATUTS = ['🔄', '⏸', '✅', '⛔'];

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Lit un fichier du dépôt ; lève si illisible (pas de pré-test d'existence). */
function lire(/** @type {string} */ relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch (erreur) {
    throw new Error(
      `${relatif} illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Découpage — CONTRIBUTING
// ---------------------------------------------------------------------------

/**
 * La section « Encore réels » de CONTRIBUTING, du marqueur jusqu'au prochain
 * titre de niveau 2. Rend `null` si le marqueur a disparu.
 *
 * @param {string} texte
 * @returns {{ debut: number, fin: number, corps: string } | null}
 */
function sectionListe(texte) {
  const debut = texte.indexOf(MARQUEUR_LISTE);
  if (debut === -1) return null;
  const suite = texte.indexOf('\n## ', debut);
  const fin = suite === -1 ? texte.length : suite;
  return { debut, fin, corps: texte.slice(debut, fin) };
}

/**
 * Les entrées de la liste : une puce de premier niveau et ses lignes de
 * continuation (la prose est enveloppée à la main dans ce dépôt, une entrée
 * fait couramment dix lignes).
 *
 * @param {string} texte
 * @returns {{ texte: string, ligne: number }[] | null}  `null` si la section a disparu
 */
function entreesDeLaListe(texte) {
  const section = sectionListe(texte);
  if (section === null) return null;

  const decalage = texte.slice(0, section.debut).split(/\r?\n/).length;
  /** @type {{ texte: string, ligne: number }[]} */
  const entrees = [];
  let courante = null;
  const lignes = section.corps.split(/\r?\n/);
  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i] ?? '';
    if (/^- /.test(ligne)) {
      courante = { texte: ligne, ligne: decalage + i };
      entrees.push(courante);
    } else if (courante !== null && /^\s+\S/.test(ligne)) {
      courante.texte += `\n${ligne}`;
    } else if (ligne.trim() === '') {
      courante = null;
    }
  }
  return entrees;
}

/** Les identifiants `EM-xx` cités dans un texte, dédoublonnés, dans l'ordre. */
function empechementsCites(/** @type {string} */ texte) {
  return [...new Set([...texte.matchAll(/`(EM-\d+)`/g)].map((m) => m[1]))];
}

// ---------------------------------------------------------------------------
// Découpage — registre
// ---------------------------------------------------------------------------

/** Découpe une ligne de tableau Markdown ; le `\|` échappé appartient au texte. */
function cellules(/** @type {string} */ ligne) {
  return ligne
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cellule) => cellule.trim());
}

/** Normalise un intitulé de colonne (casse, accents, gras Markdown). */
function normaliser(/** @type {string} */ intitule) {
  return intitule
    .replace(/\*\*/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Les lignes `EM-xx` du registre, indexées par identifiant, avec les colonnes
 * repérées par leur **intitulé** — jamais par un rang codé en dur, pour qu'une
 * colonne insérée un jour ne décale pas silencieusement les verdicts.
 *
 * @param {string} texte
 * @returns {Map<string, { statut: string, critere: string, preuve: string, ligne: number }> | null}
 */
function lignesEmpechements(texte) {
  const lignes = texte.split(/\r?\n/);
  let i = lignes.findIndex((ligne) => TITRE_SECTION_EM.test(ligne));
  if (i === -1) return null;

  while (i < lignes.length && !(lignes[i] ?? '').trimStart().startsWith('|')) {
    if (
      /^#{2,3} /.test(lignes[i] ?? '') &&
      i !== 0 &&
      !TITRE_SECTION_EM.test(lignes[i] ?? '')
    ) {
      return null; // un nouveau titre avant tout tableau : la section n'en a pas
    }
    i += 1;
  }
  if (i >= lignes.length) return null;

  const entetes = cellules(lignes[i] ?? '').map(normaliser);
  const index = (/** @type {string} */ nom) =>
    entetes.findIndex((entete) => entete.startsWith(nom));
  const iStatut = index('statut');
  const iCritere = index('critere');
  const iPreuve = index('preuve');

  /** @type {Map<string, { statut: string, critere: string, preuve: string, ligne: number }>} */
  const trouvees = new Map();
  for (
    i += 2;
    i < lignes.length && (lignes[i] ?? '').trimStart().startsWith('|');
    i += 1
  ) {
    const cases = cellules(lignes[i] ?? '');
    const id = (cases[0] ?? '').replace(/`/g, '').trim();
    if (!/^EM-\d+$/.test(id)) continue;
    trouvees.set(id, {
      statut: cases[iStatut] ?? '',
      critere: cases[iCritere] ?? '',
      preuve: cases[iPreuve] ?? '',
      ligne: i + 1,
    });
  }
  return trouvees.size === 0 ? null : trouvees;
}

/** Une cellule vide, ou réduite au tiret cadratin, ne dit rien. */
function vide(/** @type {string | undefined} */ cellule) {
  return !cellule || cellule.replace(/[—–-]/g, '').trim() === '';
}

// ---------------------------------------------------------------------------
// Vérification
// ---------------------------------------------------------------------------

/**
 * @typedef {{ code: string, ou: string, quoi: string, remede: string }} Constat
 */

/**
 * @param {string} contributing
 * @param {string} registre
 * @returns {{ constats: Constat[], couverts: number }}
 */
function verifier(contributing, registre) {
  /** @type {Constat[]} */
  const constats = [];
  const erreur = (code, ou, quoi, remede) =>
    constats.push({ code, ou, quoi, remede });

  const entrees = entreesDeLaListe(contributing);
  const empechements = lignesEmpechements(registre);

  if (entrees === null || entrees.length === 0) {
    erreur(
      'section-vide',
      `${CONTRIBUTING} — « ${MARQUEUR_LISTE} »`,
      'liste introuvable ou sans aucune entrée : un balayage à vide est indiscernable d’un succès.',
      'rétablir la section, ou corriger le marqueur attendu par le script.',
    );
  }
  if (empechements === null) {
    erreur(
      'section-vide',
      `${REGISTRE} — §6 Empêchements`,
      'section absente ou sans aucune ligne `EM-xx`.',
      'rétablir la section et son tableau, ou corriger le titre attendu par le script.',
    );
  }
  if (entrees === null || entrees.length === 0 || empechements === null) {
    return { constats, couverts: 0 };
  }

  /** @type {Map<string, number>} première ligne où l'identifiant a été cité */
  const dejaCites = new Map();
  let couverts = 0;

  for (const entree of entrees) {
    const premiere = (entree.texte.split('\n')[0] ?? '').slice(0, 70);
    const cites = empechementsCites(entree.texte);

    if (cites.length === 0) {
      erreur(
        'piege-sans-empechement',
        `${CONTRIBUTING}:${entree.ligne}`,
        `« ${premiere}… » ne cite aucun \`EM-xx\` : ce piège est décrit comme une fatalité, rien ne le met en file.`,
        'ouvrir une ligne au §6 du registre (`/consigner`), puis citer son identifiant ici.',
      );
      continue;
    }
    if (cites.length > 1) {
      erreur(
        'empechement-multiple',
        `${CONTRIBUTING}:${entree.ligne}`,
        `« ${premiere}… » cite ${cites.length} empêchements (${cites.join(', ')}) : on ne sait plus lequel répond de ce piège.`,
        'scinder l’entrée, ou ne citer que la ligne qui porte réellement son remède.',
      );
      continue;
    }

    const id = cites[0] ?? '';
    const ligneRegistre = empechements.get(id);
    if (ligneRegistre === undefined) {
      erreur(
        'empechement-inconnu',
        `${CONTRIBUTING}:${entree.ligne}`,
        `« ${premiere}… » cite ${id}, absent du §6 du registre.`,
        'créer la ligne, ou corriger la référence.',
      );
      continue;
    }

    const premiereCitation = dejaCites.get(id);
    if (premiereCitation !== undefined) {
      erreur(
        'empechement-partage',
        `${CONTRIBUTING}:${entree.ligne}`,
        `${id} est déjà cité ligne ${premiereCitation} : deux pièges se partagent une seule ligne, la file ment sur sa taille.`,
        'ouvrir une ligne par piège — un remède qui en couvre deux les clôt tous les deux, il ne les confond pas.',
      );
      continue;
    }
    dejaCites.set(id, entree.ligne);
    couverts += 1;

    const { statut, critere, preuve, ligne } = ligneRegistre;
    if (!STATUTS.includes(statut)) {
      erreur(
        'statut-inconnu',
        `${REGISTRE}:${ligne}`,
        `statut « ${statut} » inconnu pour ${id}.`,
        `statuts valides : ${STATUTS.join(' ')} (cf. §1.2).`,
      );
      continue;
    }
    if (statut === '✅') {
      erreur(
        'empechement-clos-encore-liste',
        `${CONTRIBUTING}:${entree.ligne}`,
        `${id} est ✅ (remède livré) mais son piège est toujours listé comme « ${MARQUEUR_LISTE} ».`,
        'retirer l’entrée de CONTRIBUTING — la liste doit maigrir quand l’atelier progresse.',
      );
      continue;
    }
    if (statut === '⛔') {
      if (!/\d{4}-\d{2}-\d{2}/.test(preuve)) {
        erreur(
          'renoncement-sans-date',
          `${REGISTRE}:${ligne}`,
          `${id} est écarté sans date : un renoncement sans date ne se relit pas, il se subit.`,
          'écrire « Écarté le AAAA-MM-JJ — <raison> » en colonne Preuve.',
        );
      }
      continue;
    }
    if (vide(critere)) {
      erreur(
        'empechement-sans-remede',
        `${REGISTRE}:${ligne}`,
        `${id} est ouvert sans critère de sortie : rien ne dira jamais que le piège a cessé d’exister.`,
        'écrire ce qui devra être vrai pour clore la ligne, ou l’écarter en ⛔ avec sa raison datée.',
      );
    }
  }

  return { constats, couverts };
}

// ---------------------------------------------------------------------------
// Sondes négatives — la porte doit mordre
// ---------------------------------------------------------------------------

/**
 * Remplace la n-ième cellule de la ligne de tableau portant `id`. La ligne est
 * retrouvée par son identifiant et découpée avec la même règle que la lecture :
 * aucune position n'est supposée.
 *
 * @param {string} registre
 * @param {string} id
 * @param {(entetes: string[]) => number} choisirColonne
 * @param {string} valeur
 */
function muterCellule(registre, id, choisirColonne, valeur) {
  const lignes = registre.split(/\r?\n/);
  const iLigne = lignes.findIndex((ligne) =>
    new RegExp(`^\\|\\s*\`?${id}\`?\\s*\\|`).test(ligne.trim()),
  );
  if (iLigne === -1) return registre;

  // L'en-tête est la première ligne de tableau au-dessus qui nomme la colonne ID.
  let iEntete = iLigne;
  while (iEntete > 0 && !/^\|\s*ID\s*\|/.test((lignes[iEntete] ?? '').trim())) {
    iEntete -= 1;
  }
  const entetes = cellules(lignes[iEntete] ?? '').map(normaliser);
  const index = choisirColonne(entetes);
  if (index < 0) return registre;

  const brutes = (lignes[iLigne] ?? '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/);
  if (index >= brutes.length) return registre;
  brutes[index] = ` ${valeur} `;
  lignes[iLigne] = `|${brutes.join('|')}|`;
  return lignes.join('\n');
}

/**
 * Chaque sonde abîme une copie EN MÉMOIRE des documents réels et exige le
 * constat correspondant. Les cibles sont **calculées** : la première entrée de
 * la liste, le dernier identifiant cité, le premier `EM` ouvert — jamais un
 * identifiant écrit ici. Une sonde qui ne s'applique plus (parce que le
 * document a changé de forme) échoue au lieu de passer en silence.
 *
 * @type {{ nom: string, code: string, abimer: (c: string, r: string) => { c: string, r: string } }[]}
 */
const SONDES = [
  {
    nom: 'piège de la liste sans ligne au registre',
    code: 'piege-sans-empechement',
    // La DERNIÈRE citation de la section, quelle qu'elle soit, effacée.
    abimer: (c, r) => {
      const section = sectionListe(c);
      if (section === null) return { c, r };
      const cites = [...section.corps.matchAll(/`EM-\d+`/g)];
      const dernier = cites.at(-1);
      if (dernier === undefined) return { c, r };
      const position = section.debut + (dernier.index ?? 0);
      return {
        c: c.slice(0, position) + c.slice(position + dernier[0].length),
        r,
      };
    },
  },
  {
    nom: 'piège qui cite un empêchement inexistant',
    code: 'empechement-inconnu',
    // Identifiant DÉRIVÉ : un cran au-dessus du plus grand numéro du registre,
    // donc inexistant par construction — et il le reste quand la famille grandit.
    abimer: (c, r) => {
      const numeros = [...r.matchAll(/\|\s*EM-(\d+)\s*\|/g)].map((m) =>
        Number(m[1]),
      );
      if (numeros.length === 0) return { c, r };
      const absent = `EM-${String(Math.max(...numeros) + 1).padStart(2, '0')}`;
      return { c: c.replace(/`EM-\d+`/, `\`${absent}\``), r };
    },
  },
  {
    nom: 'deux pièges qui se partagent un empêchement',
    code: 'empechement-partage',
    abimer: (c, r) => {
      const section = sectionListe(c);
      if (section === null) return { c, r };
      const cites = [...section.corps.matchAll(/`EM-\d+`/g)];
      const premier = cites[0];
      const dernier = cites.at(-1);
      if (premier === undefined || dernier === undefined || cites.length < 2) {
        return { c, r };
      }
      const position = section.debut + (dernier.index ?? 0);
      return {
        c:
          c.slice(0, position) +
          premier[0] +
          c.slice(position + dernier[0].length),
        r,
      };
    },
  },
  {
    nom: 'empêchement clos mais toujours listé',
    code: 'empechement-clos-encore-liste',
    // Cible dérivée : le PREMIER empêchement cité par la liste, quel qu'il soit.
    abimer: (c, r) => {
      const cite = /`(EM-\d+)`/.exec(sectionListe(c)?.corps ?? '');
      if (cite === null) return { c, r };
      return {
        c,
        r: muterCellule(
          r,
          cite[1] ?? '',
          (entetes) => entetes.findIndex((e) => e.startsWith('statut')),
          '✅',
        ),
      };
    },
  },
  {
    nom: 'empêchement ouvert sans critère de sortie',
    code: 'empechement-sans-remede',
    // Cible dérivée : le premier empêchement cité qui soit encore OUVERT.
    abimer: (c, r) => {
      const lignes = lignesEmpechements(r);
      const section = sectionListe(c);
      if (lignes === null || section === null) return { c, r };
      const cible = empechementsCites(section.corps).find(
        (id) =>
          lignes.get(id)?.statut === '🔄' || lignes.get(id)?.statut === '⏸',
      );
      if (cible === undefined) return { c, r };
      return {
        c,
        r: muterCellule(
          r,
          cible,
          (entetes) => entetes.findIndex((e) => e.startsWith('critere')),
          '—',
        ),
      };
    },
  },
  {
    nom: 'renoncement sans date',
    code: 'renoncement-sans-date',
    // Cible dérivée : le premier empêchement cité qui soit ÉCARTÉ.
    abimer: (c, r) => {
      const lignes = lignesEmpechements(r);
      const section = sectionListe(c);
      if (lignes === null || section === null) return { c, r };
      const cible = empechementsCites(section.corps).find(
        (id) => lignes.get(id)?.statut === '⛔',
      );
      if (cible === undefined) return { c, r };
      const preuve = (lignes.get(cible)?.preuve ?? '').replace(
        /\d{4}-\d{2}-\d{2}/g,
        'un jour',
      );
      return {
        c,
        r: muterCellule(
          r,
          cible,
          (entetes) => entetes.findIndex((e) => e.startsWith('preuve')),
          preuve,
        ),
      };
    },
  },
  {
    nom: 'liste vidée de ses entrées',
    code: 'section-vide',
    abimer: (c, r) => {
      const section = sectionListe(c);
      if (section === null) return { c, r };
      const corps = section.corps
        .split(/\r?\n/)
        .filter((ligne) => !/^- |^\s+\S/.test(ligne))
        .join('\n');
      return { c: c.slice(0, section.debut) + corps + c.slice(section.fin), r };
    },
  },
];

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

function autotest(
  /** @type {string} */ contributing,
  /** @type {string} */ registre,
) {
  let echecs = 0;
  for (const sonde of SONDES) {
    const { c, r } = sonde.abimer(contributing, registre);
    if (c === contributing && r === registre) {
      console.error(
        `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la cible a bougé, la sonde ne teste plus rien.`,
      );
      echecs += 1;
      continue;
    }
    const { constats } = verifier(c, r);
    if (!constats.some((constat) => constat.code === sonde.code)) {
      console.error(
        `❌ sonde « ${sonde.nom} » : aucun constat « ${sonde.code} » — la porte ne mord pas.`,
      );
      echecs += 1;
    } else {
      console.log(`✅ sonde « ${sonde.nom} » — constat ${sonde.code} levé.`);
    }
  }

  const { constats } = verifier(contributing, registre);
  if (constats.length > 0) {
    console.error(
      `❌ les documents RÉELS lèvent ${constats.length} constat(s) : les sondes ne prouvent rien si le témoin est déjà rouge.`,
    );
    echecs += 1;
  }
  console.log(`\n${SONDES.length} sonde(s) rejouée(s), ${echecs} échec(s).`);
  return echecs === 0 ? 0 : 1;
}

function principal() {
  const contributing = lire(CONTRIBUTING);
  const registre = lire(REGISTRE);

  if (process.argv.includes('--autotest')) {
    return autotest(contributing, registre);
  }

  const { constats, couverts } = verifier(contributing, registre);
  for (const constat of constats) {
    console.error(
      `::error::${constat.ou} — ${constat.quoi}\n   → ${constat.remede}`,
    );
  }
  if (constats.length > 0) {
    console.error(`Empêchements d’outillage : ${constats.length} constat(s).`);
    return 1;
  }
  console.log(
    `Empêchements d’outillage : ${couverts} piège(s) de CONTRIBUTING adossé(s) à une ligne EM-xx (remède ou renoncement daté), 0 constat.`,
  );
  return 0;
}

process.exitCode = principal();
