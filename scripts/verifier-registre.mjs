#!/usr/bin/env node
// @ts-check
/**
 * Porte du registre d'améliorations, de leçons et de portes
 * (`docs/34-registre-ameliorations.md`).
 *
 * ## Pourquoi ce script existe
 *
 * Le dépôt tenait déjà des registres — anomalies (doc 22), actions d'audit
 * (docs 25 et 27). Tous ont dérivé de la même façon : des statuts déclarés à la
 * main, jamais re-confrontés, « périmés au point de contredire la réalité »
 * (constat du lot 3 de l'audit de juillet 2026). Un registre non gardé finit par
 * coûter plus qu'il ne rapporte : on cesse de lui faire confiance, donc on cesse
 * de l'écrire.
 *
 * Ce script rend la **forme** opposable, pas le jugement :
 *
 *   1. identifiants uniques et contigus par famille (`AM`, `EM`, `LE`, `MO`) ;
 *   2. pas de statut sans sa contrepartie — une ligne close porte une PREUVE,
 *      une ligne ouverte porte un CRITÈRE DE SORTIE (piste, empêchement) ou une
 *      PRÉVENTION (leçon) ;
 *   3. le compteur d'un motif récurrent est recalculé depuis les leçons qui le
 *      citent, dans les DEUX sens : un motif ne peut ni gonfler ni oublier une
 *      occurrence ;
 *   4. **à la troisième récurrence, un motif doit porter une porte** — la règle
 *      qui a manqué au motif « périmètre de l'outil », relevé huit fois sans
 *      jamais devenir une garde ;
 *   5. anti-péremption : tout chemin de dépôt et toute fiche de mémoire cités
 *      doivent exister ;
 *   6. ratchet des portes sans sonde négative rejouable : le nombre ne peut que
 *      baisser (même contrat que `lint-baseline.json`).
 *
 * Il publie enfin le backlog ouvert dans `GITHUB_STEP_SUMMARY` : les sujets à
 * traiter passent sous les yeux à chaque run, au lieu d'attendre un audit.
 *
 * ## Ce que le script NE fait pas
 *
 * Il ne juge ni la pertinence d'une piste, ni la justesse d'une leçon, ni la
 * réalité d'une prévention. Une ligne bien formée mais fausse passe — c'est le
 * rôle de la revue. La porte garde la forme, les preuves et les compteurs.
 *
 * ## Usage
 *   pnpm registre               # vérifie (exit 1 si un constat)
 *   pnpm registre --autotest    # rejoue les sondes négatives (exit 1 si une porte ne mord pas)
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : si le document est introuvable ou si une
 *    section attendue est vide, le script ÉCHOUE au lieu de rendre « rien à
 *    signaler » (un balayage à vide est indiscernable d'un succès).
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture : ce couple est la fenêtre TOCTOU que la règle CodeQL
 *    `js/file-system-race` (bloquante en CI) refuse.
 *  - Aucune dépendance : le script tourne sur un clone sans `node_modules`.
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const REGISTRE = 'docs/34-registre-ameliorations.md';

/**
 * Portes du §5 dépourvues de sonde négative rejouable, à la date d'ouverture du
 * registre. Les négatifs de ces portes ont été joués À LA MAIN pendant leur lot
 * d'origine : la preuve existe, elle n'est pas rejouable. Ce plafond ne se
 * relève pas (piste `AM-21`).
 */
const PLAFOND_PORTES_SANS_SONDE = 19;

const STATUTS = ['🔄', '⏸', '✅', '⛔'];
const STATUTS_CLOS = ['✅', '⛔'];

/** Préfixes des fiches de `.claude/memory/` citées dans le registre. */
const PREFIXES_FICHES = [
  'piege-',
  'feature-',
  'plan-',
  'chantier-',
  'audit-',
  'veille-',
  'dep-',
  'prod-',
];

// ---------------------------------------------------------------------------
// Lecture et découpage
// ---------------------------------------------------------------------------

/** Lit un fichier ; `null` s'il est absent ou illisible (pas de pré-test). */
function lireTexte(/** @type {string} */ chemin) {
  try {
    return fs.readFileSync(chemin, 'utf8');
  } catch {
    return null;
  }
}

/** Vrai si le chemin existe (statSync en try/catch — pas d'`existsSync`). */
function existe(/** @type {string} */ chemin) {
  try {
    fs.statSync(chemin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Découpe une ligne de tableau Markdown en cellules. Le `|` échappé (`\|`)
 * appartient au texte : il apparaît dans le registre (`role="status"\|"alert"`),
 * et le confondre avec un séparateur décalerait toutes les colonnes suivantes.
 */
function cellules(/** @type {string} */ ligne) {
  return ligne
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cellule) => cellule.replace(/\\\|/g, '|').trim());
}

/** Normalise un intitulé de colonne (casse, accents, gras Markdown). */
function normaliser(/** @type {string} */ intitule) {
  return intitule
    .replace(/\*\*/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Premier tableau qui suit un titre de section.
 *
 * @param {string} texte
 * @param {RegExp} titre
 * @returns {{ entetes: string[], lignes: { cellules: string[], ligne: number }[] } | null}
 */
function tableauApres(texte, titre) {
  const lignes = texte.split(/\r?\n/);
  let debut = -1;
  for (let i = 0; i < lignes.length; i += 1) {
    if (titre.test(lignes[i])) {
      debut = i;
      break;
    }
  }
  if (debut === -1) return null;

  let i = debut + 1;
  while (i < lignes.length && !lignes[i].trimStart().startsWith('|')) {
    // Un nouveau titre avant tout tableau : la section n'en contient pas.
    if (/^#{2,3} /.test(lignes[i])) return null;
    i += 1;
  }
  if (i >= lignes.length) return null;

  const entetes = cellules(lignes[i]).map(normaliser);
  i += 2; // ligne de séparation
  const corps = [];
  for (; i < lignes.length && lignes[i].trimStart().startsWith('|'); i += 1) {
    corps.push({ cellules: cellules(lignes[i]), ligne: i + 1 });
  }
  return { entetes, lignes: corps };
}

/** Index d'une colonne par son intitulé normalisé (recherche par préfixe). */
function colonne(/** @type {string[]} */ entetes, /** @type {string} */ nom) {
  return entetes.findIndex((entete) => entete.startsWith(nom));
}

/** Une cellule vide, ou réduite au tiret cadratin, ne dit rien. */
function vide(/** @type {string | undefined} */ cellule) {
  return !cellule || cellule.replace(/[—–-]/g, '').trim() === '';
}

// ---------------------------------------------------------------------------
// Vérifications
// ---------------------------------------------------------------------------

/**
 * @typedef {{ code: string, ou: string, quoi: string, remede: string }} Constat
 */

/**
 * @param {string} texte    Contenu du registre.
 * @param {(chemin: string) => boolean} verifierChemin  Injecté pour que les sondes négatives
 *                                                      testent la règle sans toucher au disque.
 * @returns {{ constats: Constat[], stats: Record<string, number>, ouvertes: string[][] }}
 */
function verifier(texte, verifierChemin) {
  /** @type {Constat[]} */
  const constats = [];
  const erreur = (code, ou, quoi, remede) =>
    constats.push({ code, ou, quoi, remede });

  const pistes = tableauApres(texte, /^## 2\. Pistes/);
  const lecons = tableauApres(texte, /^## 3\. Leçons/);
  const motifs = tableauApres(texte, /^## 4\. Motifs/);
  const portes = tableauApres(texte, /^## 5\. Inventaire des portes/);
  const empechements = tableauApres(texte, /^## 6\. Empêchements/);

  for (const [nom, tableau] of [
    ['§2 Pistes', pistes],
    ['§3 Leçons', lecons],
    ['§4 Motifs', motifs],
    ['§5 Portes', portes],
    ['§6 Empêchements', empechements],
  ]) {
    if (!tableau || tableau.lignes.length === 0) {
      erreur(
        'section-vide',
        `${REGISTRE} — ${nom}`,
        'section absente ou sans aucune ligne : un balayage à vide est indiscernable d’un succès.',
        'rétablir la section et son tableau, ou corriger le titre attendu par le script.',
      );
    }
  }
  if (!pistes || !lecons || !motifs || !portes || !empechements) {
    return { constats, stats: {}, ouvertes: [] };
  }

  // --- Familles : identifiants uniques et contigus -------------------------
  /** @type {Record<string, { lignes: Map<string, string[]>, ligneNo: Map<string, number> }>} */
  const familles = {};
  for (const [famille, tableau] of [
    ['AM', pistes],
    ['EM', empechements],
    ['LE', lecons],
    ['MO', motifs],
  ]) {
    const vues = new Map();
    const numeros = [];
    const ligneNo = new Map();
    for (const ligne of tableau.lignes) {
      const brut = ligne.cellules[0].replace(/`/g, '').trim();
      const correspondance = /^([A-Z]{2})-(\d+)$/.exec(brut);
      if (!correspondance || correspondance[1] !== famille) {
        erreur(
          'identifiant-invalide',
          `${REGISTRE}:${ligne.ligne}`,
          `identifiant « ${brut} » hors de la famille ${famille}.`,
          `écrire ${famille}-01, ${famille}-02, … dans la première colonne.`,
        );
        continue;
      }
      if (vues.has(brut)) {
        erreur(
          'identifiant-duplique',
          `${REGISTRE}:${ligne.ligne}`,
          `identifiant ${brut} déjà utilisé : deux lignes portent le même sujet.`,
          'attribuer le premier numéro libre de la famille.',
        );
        continue;
      }
      vues.set(brut, ligne.cellules);
      ligneNo.set(brut, ligne.ligne);
      numeros.push(Number(correspondance[2]));
    }
    numeros.sort((a, b) => a - b);
    numeros.forEach((numero, index) => {
      if (numero !== index + 1) {
        erreur(
          'sequence-trouee',
          `${REGISTRE} — famille ${famille}`,
          `séquence trouée : ${famille}-${String(numero).padStart(2, '0')} arrive au rang ${index + 1}.`,
          'ne jamais supprimer une ligne — la passer en ⛔ écarté avec sa raison.',
        );
      }
    });
    familles[famille] = { lignes: vues, ligneNo };
  }

  // --- Pistes et empêchements : statut, critère de sortie, preuve -----------
  // Les deux familles partagent la même forme de tableau (une ligne ouverte doit
  // dire à quelle condition elle se ferme) et le même backlog publié : une piste
  // dit ce que le PRODUIT devrait être, un empêchement ce que l'ATELIER coûte,
  // mais aucune des deux ne se clôt sans critère de sortie. Les index de colonnes
  // sont relus par tableau : rien n'oblige les deux à garder le même ordre.
  const stats = { P1: 0, P2: 0, P3: 0, ouvertes: 0, bloquees: 0, closes: 0 };
  /** @type {string[][]} */
  const ouvertes = [];

  for (const [famille, tableau] of [
    ['AM', pistes],
    ['EM', empechements],
  ]) {
    const iStatut = colonne(tableau.entetes, 'statut');
    const iCritere = colonne(tableau.entetes, 'critere');
    const iPreuve = colonne(tableau.entetes, 'preuve');
    const iPrio = colonne(tableau.entetes, 'prio');
    const iConstat = colonne(tableau.entetes, 'constat');

    for (const [id, cellulesLigne] of familles[famille].lignes) {
      const ligne = familles[famille].ligneNo.get(id) ?? 0;
      const statut = cellulesLigne[iStatut];
      if (!STATUTS.includes(statut)) {
        erreur(
          'statut-inconnu',
          `${REGISTRE}:${ligne}`,
          `statut « ${statut} » inconnu pour ${id}.`,
          `statuts valides : ${STATUTS.join(' ')} (cf. §1.2).`,
        );
        continue;
      }
      if (STATUTS_CLOS.includes(statut)) {
        stats.closes += 1;
        if (vide(cellulesLigne[iPreuve])) {
          erreur(
            'clos-sans-preuve',
            `${REGISTRE}:${ligne}`,
            `${id} est ${statut} sans preuve : c’est exactement ainsi que les tableaux AQ-xx se sont périmés.`,
            'citer la PR, le commit ou le fichier qui le prouve — ou rouvrir la ligne.',
          );
        }
      } else {
        stats.ouvertes += 1;
        if (statut === '⏸') stats.bloquees += 1;
        const prio = (cellulesLigne[iPrio] ?? '').toUpperCase();
        if (prio in stats) stats[prio] += 1;
        ouvertes.push([id, prio, cellulesLigne[iConstat] ?? '', statut]);
        if (vide(cellulesLigne[iCritere])) {
          erreur(
            'ouvert-sans-critere',
            `${REGISTRE}:${ligne}`,
            `${id} est ouvert sans critère de sortie : rien ne dira jamais qu’il est fini.`,
            'écrire ce qui devra être vrai pour clore la ligne.',
          );
        }
      }
    }
  }

  // --- Leçons : prévention, preuve, motif rattaché --------------------------
  const iStatutLE = colonne(lecons.entetes, 'statut');
  const iPrevention = colonne(lecons.entetes, 'prevention');
  const iPreuveLE = colonne(lecons.entetes, 'preuve');
  const iMotif = colonne(lecons.entetes, 'motif');
  /** @type {Map<string, string[]>} */
  const leconsParMotif = new Map();

  for (const [id, cellulesLigne] of familles['LE'].lignes) {
    const ligne = familles['LE'].ligneNo.get(id) ?? 0;
    const statut = cellulesLigne[iStatutLE];
    if (!STATUTS.includes(statut)) {
      erreur(
        'statut-inconnu',
        `${REGISTRE}:${ligne}`,
        `statut « ${statut} » inconnu pour ${id}.`,
        `statuts valides : ${STATUTS.join(' ')} (cf. §1.2).`,
      );
      continue;
    }
    if (STATUTS_CLOS.includes(statut) && vide(cellulesLigne[iPreuveLE])) {
      erreur(
        'clos-sans-preuve',
        `${REGISTRE}:${ligne}`,
        `${id} est ${statut} sans preuve.`,
        'citer la PR, le lot ou la fiche qui porte la prévention livrée.',
      );
    }
    if (!STATUTS_CLOS.includes(statut) && vide(cellulesLigne[iPrevention])) {
      erreur(
        'lecon-sans-prevention',
        `${REGISTRE}:${ligne}`,
        `${id} est ouverte sans prévention : une leçon sans suite est une anecdote.`,
        'écrire la prévention visée, ou assumer le risque par écrit et clore en ⛔.',
      );
    }
    const motif = (cellulesLigne[iMotif] ?? '').replace(/`/g, '').trim();
    if (!vide(motif)) {
      if (!familles['MO'].lignes.has(motif)) {
        erreur(
          'motif-inconnu',
          `${REGISTRE}:${ligne}`,
          `${id} cite le motif ${motif}, absent du §4.`,
          'créer le motif, ou corriger la référence.',
        );
      } else {
        leconsParMotif.set(motif, [...(leconsParMotif.get(motif) ?? []), id]);
      }
    }
  }

  // --- Motifs : compteur recalculé dans les deux sens, règle des 3 ----------
  const iOccurrences = colonne(motifs.entetes, 'occurrence');
  const iPorte = colonne(motifs.entetes, 'porte');

  for (const [id, cellulesLigne] of familles['MO'].lignes) {
    const ligne = familles['MO'].ligneNo.get(id) ?? 0;
    const brut = cellulesLigne[iOccurrences] ?? '';
    const cites = [...brut.matchAll(/LE-\d+/g)].map((m) => m[0]);
    const reels = leconsParMotif.get(id) ?? [];

    for (const cite of cites) {
      if (!familles['LE'].lignes.has(cite)) {
        erreur(
          'occurrence-fantome',
          `${REGISTRE}:${ligne}`,
          `${id} cite ${cite}, qui n’existe pas au §3.`,
          'corriger la liste des occurrences.',
        );
      } else if (!reels.includes(cite)) {
        erreur(
          'occurrence-non-reciproque',
          `${REGISTRE}:${ligne}`,
          `${id} cite ${cite}, mais ${cite} ne rattache pas ce motif.`,
          `renseigner ${id} dans la colonne « Motif » de ${cite}, ou retirer la citation.`,
        );
      }
    }
    for (const reel of reels) {
      if (!cites.includes(reel)) {
        erreur(
          'occurrence-manquante',
          `${REGISTRE}:${ligne}`,
          `${reel} rattache ${id}, mais ${id} ne la compte pas : un motif qui oublie une occurrence n’atteint jamais son seuil.`,
          `ajouter ${reel} aux occurrences de ${id}.`,
        );
      }
    }

    const annonce = /×\s*(\d+)/.exec(brut);
    if (!annonce) {
      erreur(
        'compteur-absent',
        `${REGISTRE}:${ligne}`,
        `${id} n’annonce pas son compteur (« ×N »).`,
        'écrire les occurrences sous la forme « LE-01, LE-02 (×2) ».',
      );
    } else if (Number(annonce[1]) !== reels.length) {
      erreur(
        'compteur-faux',
        `${REGISTRE}:${ligne}`,
        `${id} annonce ×${annonce[1]} pour ${reels.length} leçon(s) rattachée(s).`,
        'recompter — le seuil de la règle des trois en dépend.',
      );
    }

    if (reels.length >= 3 && vide(cellulesLigne[iPorte])) {
      erreur(
        'motif-sans-porte',
        `${REGISTRE}:${ligne}`,
        `${id} atteint ${reels.length} occurrences sans porte : à la troisième récurrence, on n’écrit plus une leçon, on écrit une porte (§1.3).`,
        'outiller le motif, ou écrire pourquoi il ne peut pas l’être.',
      );
    }
  }

  // --- Portes : périmètre déclaré et sonde négative -------------------------
  const iGarantit = colonne(portes.entetes, 'garantit');
  const iNonCouvert = colonne(portes.entetes, 'ne couvre');
  const iSonde = colonne(portes.entetes, 'sonde');
  let sansSonde = 0;

  for (const ligne of portes.lignes) {
    const nom = ligne.cellules[0];
    for (const [index, intitule] of [
      [iGarantit, 'ce qu’elle garantit'],
      [iNonCouvert, 'ce qu’elle ne couvre pas'],
      [iSonde, 'sa sonde négative'],
    ]) {
      if (vide(ligne.cellules[Number(index)])) {
        erreur(
          'porte-incomplete',
          `${REGISTRE}:${ligne.ligne}`,
          `la porte « ${nom} » ne déclare pas ${intitule} : une porte au périmètre non écrit est une porte qu’on croit large.`,
          'renseigner la colonne — « — » n’est pas une réponse ici.',
        );
      }
    }
    if ((ligne.cellules[iSonde] ?? '').startsWith('❌')) sansSonde += 1;
  }

  if (sansSonde > PLAFOND_PORTES_SANS_SONDE) {
    erreur(
      'ratchet-sondes',
      `${REGISTRE} — §5`,
      `${sansSonde} portes sans sonde négative rejouable, pour un plafond de ${PLAFOND_PORTES_SANS_SONDE}.`,
      'toute porte ajoutée embarque sa sonde ; le plafond ne se relève pas (AM-21).',
    );
  }

  // --- Anti-péremption : chemins et fiches cités ----------------------------
  const dejaVus = new Set();
  for (const [, cite] of texte.matchAll(/`([^`\n]+)`/g)) {
    const valeur = cite.trim();
    if (dejaVus.has(valeur)) continue;
    dejaVus.add(valeur);

    if (
      /^(docs|scripts|apps|libs|\.claude|\.github)\/[\w./@-]+$/.test(valeur)
    ) {
      if (!verifierChemin(valeur)) {
        erreur(
          'chemin-perime',
          `${REGISTRE}`,
          `le chemin « ${valeur} » n’existe plus.`,
          'corriger la référence, ou dater la ligne comme relevé historique.',
        );
      }
      continue;
    }
    if (
      PREFIXES_FICHES.some((prefixe) => valeur.startsWith(prefixe)) &&
      /^[a-z0-9-]+$/.test(valeur) &&
      !verifierChemin(`.claude/memory/${valeur}.md`)
    ) {
      erreur(
        'fiche-perimee',
        `${REGISTRE}`,
        `la fiche de mémoire « ${valeur} » n’existe pas.`,
        'corriger le nom, ou créer la fiche et l’indexer dans MEMORY.md.',
      );
    }
  }

  return { constats, stats, ouvertes };
}

// ---------------------------------------------------------------------------
// Sondes négatives — la porte doit mordre
// ---------------------------------------------------------------------------

/**
 * Chaque sonde abîme une copie EN MÉMOIRE du registre réel et exige le constat
 * correspondant. Elles tournent sur le document du jour : une sonde qui cesse de
 * s'appliquer (parce que la ligne visée a changé de forme) échoue au lieu de
 * passer en silence.
 *
 * @type {{ nom: string, code: string, abimer: (texte: string) => string }[]}
 */
const SONDES = [
  {
    nom: 'identifiant dupliqué',
    code: 'identifiant-duplique',
    abimer: (texte) => texte.replace(/\|\s*AM-02\s*\|/, '| AM-01 |'),
  },
  {
    nom: 'séquence trouée',
    code: 'sequence-trouee',
    abimer: (texte) => texte.replace(/\|\s*AM-03\s*\|/, '| AM-42 |'),
  },
  {
    nom: 'piste close sans preuve',
    code: 'clos-sans-preuve',
    // Cible **dérivée** : la première piste portant un statut de clôture, quel que
    // soit son identifiant. La version d'origine visait `AM-17` **et son ⛔** —
    // elle aurait cessé de mordre le jour où cette ligne change de statut.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*AM-\d+\s*\|(?:[^|\n]*\|){4}\s*(?:✅|⛔)\s*\|)[^|\n]*\|/,
        '$1 — |',
      ),
  },
  {
    nom: 'piste ouverte sans critère de sortie',
    code: 'ouvert-sans-critere',
    // Cible **dérivée** : la première piste encore ouverte, quelle qu'elle soit. La
    // version d'origine visait `AM-01` et a cessé de mordre au lot 2b, le jour où
    // cette piste a été close — la mutation vidait alors le critère d'une ligne que
    // la porte n'évalue plus.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*AM-\d+\s*\|[^|\n]*\|[^|\n]*\|)[^|\n]*(\|[^|\n]*\|\s*🔄\s*\|)/,
        '$1 — $2',
      ),
  },
  {
    nom: 'empêchement — séquence trouée',
    code: 'sequence-trouee',
    // La famille `EM` (§6) doit entrer dans les MÊMES boucles que les autres :
    // une famille ajoutée au document mais oubliée du script serait une porte
    // qu'on croit large — le motif `MO-1`, ici à sa vingtième occurrence.
    // Cible dérivée : le premier identifiant `EM`, quel qu'il soit, projeté hors
    // de sa séquence.
    abimer: (texte) => texte.replace(/(\|\s*EM-)\d+(\s*\|)/, '$190$2'),
  },
  {
    nom: 'empêchement ouvert sans critère de sortie',
    code: 'ouvert-sans-critere',
    // Cible dérivée : le premier empêchement encore ouvert, quel qu'il soit.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*EM-\d+\s*\|[^|\n]*\|[^|\n]*\|)[^|\n]*(\|[^|\n]*\|\s*🔄\s*\|)/,
        '$1 — $2',
      ),
  },
  {
    nom: 'empêchement écarté sans preuve',
    code: 'clos-sans-preuve',
    // Cible dérivée : le premier empêchement portant un statut de clôture. Un
    // `⛔` sans raison écrite, c'est la fatalité que le §6 est censé remplacer.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*EM-\d+\s*\|(?:[^|\n]*\|){4}\s*(?:✅|⛔)\s*\|)[^|\n]*\|/,
        '$1 — |',
      ),
  },
  {
    nom: 'statut inconnu',
    code: 'statut-inconnu',
    abimer: (texte) =>
      texte.replace(/\|\s*🔄\s*\|\s*—\s*\|/, '| en cours | — |'),
  },
  {
    nom: 'leçon rattachée à un motif inexistant',
    code: 'motif-inconnu',
    // Cible **dérivée** : le motif de la première leçon, quels que soient l'un et
    // l'autre. La version d'origine visait `MO-1` **suivi de « Lot D2 »**, donc à la
    // fois le motif et l'origine d'une leçon précise.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*LE-\d+\s*\|[^|\n]*\|[^|\n]*\|)\s*`MO-\d+`\s*\|/,
        '$1 `MO-9` |',
      ),
  },
  {
    nom: 'compteur de motif faux',
    code: 'compteur-faux',
    // Le compteur du PREMIER motif, quel qu'il soit, incrémenté : la valeur
    // devient fausse par construction. La version d'origine visait le littéral
    // « (×8) » et a cessé de tester quoi que ce soit dès que MO-1 a gagné une
    // occurrence — une sonde ne doit pas se périmer à chaque leçon consignée.
    // La mutation est bornée à la SECTION des motifs : une citation du même
    // motif ailleurs dans le document (une leçon qui raconte cette sonde, par
    // exemple) détournerait sinon la mutation vers du texte que la porte
    // n'évalue pas — et la sonde passerait au vert sans rien prouver.
    abimer: (texte) => {
      const debut = texte.indexOf('## 4. Motifs');
      if (debut === -1) return texte;
      const fin = texte.indexOf('\n## ', debut + 1);
      const section = texte.slice(debut, fin === -1 ? undefined : fin);
      const abimee = section.replace(
        /\(×(\d+)\)/,
        (_, compte) => `(×${Number(compte) + 1})`,
      );
      return (
        texte.slice(0, debut) + abimee + (fin === -1 ? '' : texte.slice(fin))
      );
    },
  },
  {
    nom: 'occurrence oubliée par son motif',
    code: 'occurrence-manquante',
    // Cible **dérivée** : la première occurrence citée par le premier motif, quelle
    // qu'elle soit, retirée de sa liste. La version d'origine recopiait le début de
    // la liste de `MO-1` — elle se serait périmée au premier réordonnancement.
    abimer: (texte) =>
      texte.replace(/(\|\s*`MO-\d+`\s*\|[^|\n]*\|)\s*LE-\d+,\s*/, '$1 '),
  },
  {
    nom: 'occurrence fantôme',
    code: 'occurrence-fantome',
    // Cible **dérivée** : le premier motif du tableau, quels que soient son
    // identifiant et sa liste d'occurrences. Cette sonde visait `LE-11, LE-12
    // (×2)` en dur et a cessé de mordre au lot 2b, dès que MO-2 a gagné deux
    // occurrences. C'est la deuxième fois que ce mode de défaillance frappe ici
    // (`LE-33`) : la première correction avait dérivé la sonde qui avait échoué,
    // et laissé littérales ses sœurs, écrites de la même main.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*`MO-\d+`\s*\|[^|\n]*\|[^|\n]*?)(\(×\d+\))/,
        '$1LE-97 $2',
      ),
  },
  {
    nom: 'motif au-delà du seuil sans porte',
    code: 'motif-sans-porte',
    // Cible **dérivée** : le premier motif ayant atteint le seuil de trois, quel
    // que soit son identifiant et son compteur. La sonde visait `MO-3 (×3)` en
    // dur — elle a cessé de mordre le jour où ce motif a gagné une occurrence,
    // et seule la garde « la mutation n'a rien changé » l'a signalé. C'est
    // exactement `MO-3` : un attendu recopié à la main plutôt que dérivé.
    abimer: (texte) =>
      texte.replace(
        /(\|\s*`MO-\d+`\s*\|[^\n]*\(×(?:[3-9]|\d{2,})\)[^|\n]*\|)[^|\n]*\|/,
        '$1 — |',
      ),
  },
  {
    nom: 'porte sans périmètre déclaré',
    code: 'porte-incomplete',
    abimer: (texte) =>
      texte.replace(
        /(\|\s*`pnpm frontieres`\s*\|[^|\n]*\|)[^|\n]*\|/,
        '$1 — |',
      ),
  },
  {
    nom: 'chemin périmé',
    code: 'chemin-perime',
    abimer: (texte) =>
      texte.replace(
        '`scripts/verifier-frontieres.mjs`',
        '`scripts/verifier-frontieres-disparu.mjs`',
      ),
  },
  {
    nom: 'fiche de mémoire périmée',
    code: 'fiche-perimee',
    abimer: (texte) =>
      texte.replace('`piege-sca-rouge-sans-diff`', '`piege-qui-nexiste-pas`'),
  },
  {
    nom: 'section vidée',
    code: 'section-vide',
    abimer: (texte) =>
      texte.replace(/(## 4\. Motifs[^\n]*\n)[\s\S]*?(\n## 5\.)/, '$1$2'),
  },
];

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

const texte = lireTexte(path.join(RACINE, REGISTRE));
if (texte === null) {
  console.error(`::error::registre introuvable : ${REGISTRE}`);
  process.exit(1);
}

const surDisque = (/** @type {string} */ chemin) =>
  existe(path.join(RACINE, chemin));

if (process.argv.includes('--autotest')) {
  let echecs = 0;
  for (const sonde of SONDES) {
    const abime = sonde.abimer(texte);
    if (abime === texte) {
      console.error(
        `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la ligne visée a bougé, la sonde ne teste plus rien.`,
      );
      echecs += 1;
      continue;
    }
    const { constats } = verifier(abime, surDisque);
    if (!constats.some((constat) => constat.code === sonde.code)) {
      console.error(
        `❌ sonde « ${sonde.nom} » : aucun constat « ${sonde.code} » — la porte ne mord pas.`,
      );
      echecs += 1;
    } else {
      console.log(`✅ sonde « ${sonde.nom} » — constat ${sonde.code} levé.`);
    }
  }
  const { constats } = verifier(texte, surDisque);
  if (constats.length > 0) {
    console.error(
      `❌ le registre RÉEL lève ${constats.length} constat(s) : les sondes ne prouvent rien si le témoin est déjà rouge.`,
    );
    echecs += 1;
  }
  console.log(`\n${SONDES.length} sonde(s) rejouée(s), ${echecs} échec(s).`);
  process.exit(echecs === 0 ? 0 : 1);
}

const { constats, stats, ouvertes } = verifier(texte, surDisque);

for (const constat of constats) {
  console.error(
    `::error::${constat.ou} — ${constat.quoi}\n   → ${constat.remede}`,
  );
}

const resume = process.env['GITHUB_STEP_SUMMARY'];
if (resume) {
  const lignes = [
    '### Registre d’améliorations (doc 34)',
    '',
    `**${stats.ouvertes} sujet(s) ouvert(s)** — P1 : ${stats.P1} · P2 : ${stats.P2} · P3 : ${stats.P3} · bloqués : ${stats.bloquees} · clos : ${stats.closes}`,
    '',
  ];
  const p1 = ouvertes.filter(([, prio]) => prio === 'P1');
  if (p1.length > 0) {
    lignes.push('| ID | Statut | Constat |', '| --- | :---: | --- |');
    for (const [id, , constat, statut] of p1) {
      lignes.push(`| ${id} | ${statut} | ${constat} |`);
    }
    lignes.push('');
  }
  try {
    fs.appendFileSync(resume, `${lignes.join('\n')}\n`);
  } catch {
    /* le résumé est un confort, jamais une condition de succès */
  }
}

console.log(
  constats.length === 0
    ? `Registre : ${stats.ouvertes} sujet(s) ouvert(s), ${stats.closes} clos, 0 constat.`
    : `Registre : ${constats.length} constat(s).`,
);
process.exit(constats.length === 0 ? 0 : 1);
