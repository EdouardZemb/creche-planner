#!/usr/bin/env node
// @ts-check
/**
 * Refuse une exception de sécurité sans date d'expiration, ou dont la date est
 * passée.
 *
 * ## Pourquoi ce script existe
 *
 * Une entrée d'allowlist se pose dans un moment de lucidité — « non exploitable
 * ici, pas de correctif amont, on reverra » — et se relit six mois plus tard
 * comme un fait établi. Le 2026-08-13, une entrée `brace-expansion` posée
 * « jusqu'à ce qu'un correctif 2.x existe » est restée en place après la
 * publication de ce correctif ; elle demandait elle-même sa révision, et
 * personne ne l'a lue. Le bloc `util-linux` porte, lui, une « DATE DE REVUE »
 * écrite en prose que rien n'applique.
 *
 * C'est la même famille que tous les incidents de ce dépôt : **une affirmation
 * vraie quand elle a été écrite, fausse quand elle a été lue**. Ici
 * l'affirmation est « cette CVE est acceptable ».
 *
 * ## Ce que la porte exige
 *
 * Dans `.trivyignore`, chaque identifiant porte `exp:AAAA-MM-JJ` — la syntaxe
 * NATIVE de Trivy, donc la date fait DEUX choses : Trivy cesse de supprimer la
 * CVE une fois passée, et cette porte échoue avant, pour que l'échéance se voie
 * venir plutôt que de tomber un matin sans explication.
 *
 *  - date absente, illisible, ou identifiant seul ⇒ ERREUR ;
 *  - date passée ⇒ ERREUR (« l'exception ne protège plus, et personne n'a
 *    décidé ») ;
 *  - date à moins de 15 jours ⇒ AVERTISSEMENT ;
 *  - entrée sans une ligne de justification au-dessus d'elle ⇒ ERREUR : une
 *    exception sans raison écrite n'est pas révisable.
 *
 * ## Ce que la porte NE peut pas savoir
 *
 *  - Elle ne juge pas si la raison est BONNE, seulement qu'elle est écrite et
 *    datée. Un motif faux reste un motif.
 *  - Elle ne lit que `.trivyignore`. Les suppressions par VEX, par `--ignore-policy`
 *    Rego ou par un `.trivyignore` de sous-répertoire lui échappent — il n'y en a
 *    aucun aujourd'hui, et le jour où il y en aura, c'est ici qu'il faudra le dire.
 *  - Elle ne vérifie pas que l'identifiant existe vraiment chez l'éditeur : une
 *    entrée pour une CVE imaginaire est inerte, pas dangereuse.
 *
 * ## Usage
 *   pnpm exceptions               # ou : node scripts/verifier-exceptions-securite.mjs
 *   pnpm exceptions --autotest    # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : fichier illisible ⇒ ÉCHEC.
 *  - Aucun réseau, aucun `node_modules`.
 *  - Lectures `fs` en `try/catch` seul (règle CodeQL `js/file-system-race`).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const FICHIER = '.trivyignore';
/** Fenêtre d'avertissement avant expiration, en jours. */
const PREAVIS = 14;

/** Formes d'identifiant que Trivy accepte dans un `.trivyignore`. */
const IDENTIFIANT =
  /^(CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|AVD-[A-Z0-9]+-\d+|DS\d+|[a-z][a-z0-9-]{3,})$/;

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

/** Lecteur INJECTABLE : `--autotest` abîme le fichier EN MÉMOIRE, jamais sur disque. */
let lecteur = (relatif) => {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
};

/** Horloge injectable : une sonde ne doit pas dépendre du calendrier. */
let aujourdhui = () => new Date();

/** Une date `AAAA-MM-JJ` réelle, ou `null`. */
function jourValide(texte) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte)) return null;
  const date = new Date(`${texte}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // `2026-02-31` passe le `new Date` en le reportant : on vérifie le retour.
  return date.toISOString().slice(0, 10) === texte ? date : null;
}

/**
 * Les entrées du fichier, avec leur numéro de ligne et l'état du commentaire qui
 * les précède immédiatement.
 *
 * @param {string} contenu
 * @returns {{ ligne: number, brut: string, justifiee: boolean }[]}
 */
function entrees(contenu) {
  const lignes = contenu.split('\n');
  const trouvees = [];
  for (let i = 0; i < lignes.length; i += 1) {
    const brut = (lignes[i] ?? '').replace(/\r$/, '').trim();
    if (brut === '' || brut.startsWith('#')) continue;
    // Justifiée si l'un des 30 prédécesseurs CONTIGUS (commentaires et autres
    // entrées du même bloc, lignes vides exclues du décompte) est un commentaire
    // porteur de texte. Un identifiant lâché seul en fin de fichier ne l'est pas.
    let justifiee = false;
    for (let j = i - 1; j >= 0 && i - j <= 30; j -= 1) {
      const precedent = (lignes[j] ?? '').replace(/\r$/, '').trim();
      if (precedent === '') break;
      if (precedent.startsWith('#')) {
        if (precedent.replace(/^#+\s*/, '').replace(/[─\s]/g, '') !== '') {
          justifiee = true;
        }
        break;
      }
      // Autre identifiant du même bloc : on continue de remonter.
    }
    trouvees.push({ ligne: i + 1, brut, justifiee });
  }
  return trouvees;
}

function reinitialiser() {
  erreurs.length = 0;
  avertissements.length = 0;
  faitsVerifies.clear();
}

function executer() {
  reinitialiser();

  const contenu = lecteur(FICHIER);
  if (contenu === null) {
    erreur(
      FICHIER,
      'allowlist illisible — la porte ne garde rien.',
      'ce script se lance depuis la racine du dépôt ; le fichier est versionné.',
    );
    return { attendus: [...faitsVerifies] };
  }
  faitsVerifies.add('allowlist-lue');

  const lues = entrees(contenu);
  const jour = aujourdhui();
  let datees = 0;

  for (const { ligne, brut, justifiee } of lues) {
    const portee = `${FICHIER}:${ligne}`;
    // `IDENT exp:AAAA-MM-JJ` éventuellement suivi d'un commentaire de fin de ligne.
    const forme = /^(\S+)(?:\s+exp:(\S+))?\s*(?:#.*)?$/.exec(brut);
    if (forme === null || forme[1] === undefined) {
      erreur(
        portee,
        `ligne illisible : \`${brut}\`.`,
        'forme attendue : `IDENTIFIANT exp:AAAA-MM-JJ`.',
      );
      continue;
    }
    const [, identifiant, expiration] = forme;

    if (!IDENTIFIANT.test(identifiant)) {
      erreur(
        portee,
        `\`${identifiant}\` ne ressemble à aucun identifiant que Trivy reconnaît.`,
        'CVE-AAAA-NNNNN, GHSA-xxxx-xxxx-xxxx, AVD-XX-NNNN ou un nom de règle de secret.',
      );
      continue;
    }

    if (!justifiee) {
      erreur(
        portee,
        `\`${identifiant}\` est listée sans justification écrite au-dessus d'elle.`,
        'une exception sans raison n’est pas révisable : écrire d’où vient la CVE, pourquoi elle est acceptée, et ce qui la lèvera.',
      );
    }

    if (expiration === undefined) {
      erreur(
        portee,
        `\`${identifiant}\` n’a pas de date d’expiration.`,
        'ajouter `exp:AAAA-MM-JJ`. Une exception sans date devient un oubli permanent — c’est tout l’objet de cette porte.',
      );
      continue;
    }

    const echeance = jourValide(expiration);
    if (echeance === null) {
      erreur(
        portee,
        `\`${identifiant}\` porte une date illisible : \`${expiration}\`.`,
        'format attendu : `exp:AAAA-MM-JJ`.',
      );
      continue;
    }
    datees += 1;

    const reste = Math.floor(
      (echeance.getTime() - jour.getTime()) / 86_400_000,
    );
    if (reste < 0) {
      erreur(
        portee,
        `\`${identifiant}\` est PÉRIMÉE depuis le ${expiration} — Trivy ne la supprime plus, et personne n’a décidé.`,
        'retirer l’entrée si la CVE est corrigée, ou la REDATER en écrivant pourquoi la prolongation est acceptable.',
      );
      continue;
    }
    if (reste <= PREAVIS) {
      avertir(
        portee,
        `\`${identifiant}\` expire dans ${reste} jour(s) (${expiration}).`,
        'préparer le correctif ou la décision de prolongation maintenant, pas le jour où la porte rougit.',
      );
    }
  }

  faitsVerifies.add('entrees-datees');
  return { attendus: [...faitsVerifies], total: lues.length, datees };
}

/** @param {{ attendus: string[], total?: number, datees?: number }} bilan */
function conclure({ attendus, total, datees }) {
  for (const fait of ['allowlist-lue', 'entrees-datees']) {
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
    console.log(
      total === 0
        ? '✅ aucune exception de sécurité en vigueur.'
        : `✅ ${datees}/${total} exception(s) datée(s), justifiée(s), et encore valide(s).`,
    );
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
 * @type {{ nom: string, abimer?: (texte: string) => string, illisible?: boolean,
 *          jour?: string, attendu: RegExp }[]}
 */
const SONDES = [
  {
    nom: 'exception sans date',
    abimer: (texte) =>
      texte.replace(
        'GHSA-qwww-vcr4-c8h2 exp:2026-12-31',
        'GHSA-qwww-vcr4-c8h2',
      ),
    attendu: /n’a pas de date d’expiration/,
  },
  {
    nom: 'exception périmée',
    jour: '2027-06-01',
    attendu: /est PÉRIMÉE depuis le/,
  },
  {
    nom: 'date illisible',
    abimer: (texte) => texte.replace('exp:2026-11-02', 'exp:bientot'),
    attendu: /porte une date illisible/,
  },
  {
    nom: 'exception sans justification',
    abimer: (texte) =>
      `${texte.replace(/\s*$/, '')}\n\nCVE-2026-999999 exp:2027-01-01\n`,
    attendu: /sans justification écrite/,
  },
  {
    nom: 'identifiant qui n’en est pas un',
    abimer: (texte) => texte.replace('CVE-2026-103111 exp:', 'pcre2! exp:'),
    attendu: /ne ressemble à aucun identifiant/,
  },
  {
    nom: 'allowlist illisible',
    illisible: true,
    attendu: /allowlist illisible/,
  },
];

if (process.argv.includes('--autotest')) {
  process.exitCode = autotest();
} else {
  console.log('Exceptions de sécurité — datées, justifiées, non périmées');
  conclure(executer());
}

/** Rejoue les sondes ; rend 0 si toutes mordent et si le témoin est vert. */
function autotest() {
  const surDisque = lecteur;
  const horlogeReelle = aujourdhui;
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
    const origine = surDisque(FICHIER);
    if (origine === null) {
      console.error(
        `❌ sonde « ${sonde.nom} » : ${FICHIER} illisible — la sonde a perdu sa cible.`,
      );
      echecs += 1;
      continue;
    }

    if (sonde.illisible === true) {
      lecteur = () => null;
    } else if (sonde.abimer !== undefined) {
      const abime = sonde.abimer(origine);
      if (abime === origine) {
        console.error(
          `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la ligne visée a bougé.`,
        );
        echecs += 1;
        continue;
      }
      lecteur = (relatif) => (relatif === FICHIER ? abime : surDisque(relatif));
    }
    if (sonde.jour !== undefined) {
      const fige = new Date(`${sonde.jour}T00:00:00Z`);
      aujourdhui = () => fige;
    }

    executer();
    lecteur = surDisque;
    aujourdhui = horlogeReelle;

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
