#!/usr/bin/env node
// Compare deux balayages produits par `nx run web:e2e-visuel` : écarts de
// contraste, débordements à 375 px, et surtout EMPREINTE des styles calculés.
//
// C'est la moitié « revue » de l'outil : le balayage mesure, ce script décide.
// Il répond à une seule question — « cette refonte est-elle à iso-rendu ? » — et
// il y répond sur des valeurs calculées par le navigateur, pas sur un diff.
//
//   SORTIE=avant.json nx run web:e2e-visuel
//   …refonte…
//   SORTIE=apres.json nx run web:e2e-visuel
//   node scripts/comparer-empreinte.mjs avant.json apres.json
//
// Deux familles d'écart, distinguées à dessein :
//   - MÊME nœud, MÊMES classes, styles différents  → régression franche ;
//   - MÊME nœud, classes différentes (un style inline devenu classe, par
//     exemple) : le script les apparie par CHEMIN et compare quand même leurs
//     styles. C'est le cas normal d'une résorption d'inline, et c'est là que se
//     cache une classe qui « ressemble » sans produire la même valeur.
// Sortie 1 si un écart de style est trouvé, 0 sinon.
import { readFileSync } from 'node:fs';

// Doit rester aligné sur la liste PROPS du balayage.
const PROPS = [
  'display',
  'position',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'grid-template-columns',
  'width',
  'height',
  'min-height',
  'max-width',
  'padding',
  'margin',
  'gap',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'text-decoration-line',
  'white-space',
  'color',
  'background-color',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'outline-width',
  'outline-style',
  'outline-color',
  'box-shadow',
  'opacity',
  'z-index',
  'overflow-x',
  'overflow-y',
  'visibility',
  'vertical-align',
  'align-items',
  'justify-content',
];

const [, , cheminAvant, cheminApres] = process.argv;
if (!cheminAvant || !cheminApres) {
  console.error(
    'usage : node scripts/comparer-empreinte.mjs <avant.json> <apres.json>',
  );
  process.exit(2);
}

let avant;
let apres;
try {
  avant = JSON.parse(readFileSync(cheminAvant, 'utf8'));
  apres = JSON.parse(readFileSync(cheminApres, 'utf8'));
} catch (erreur) {
  console.error(`lecture impossible : ${erreur.message}`);
  process.exit(2);
}

const diffProps = (valA, valB) => {
  const a = valA.split('~');
  const b = valB.split('~');
  return PROPS.map((p, i) =>
    a[i] === b[i] ? null : `${p} : « ${a[i]} » → « ${b[i]} »`,
  ).filter(Boolean);
};

console.log('=== CONTRASTES ===');
console.log(
  `avant : ${avant.total} constat(s)   après : ${apres.total} constat(s)`,
);
let introduits = 0;
for (const cle of [
  ...new Set([...Object.keys(avant.rapport), ...Object.keys(apres.rapport)]),
].sort()) {
  const cleOf = (c) => `${c.genre}|${c.chemin}|${c.ratio}`;
  const a = (avant.rapport[cle] ?? []).map(cleOf);
  const b = (apres.rapport[cle] ?? []).map(cleOf);
  for (const n of b.filter((x) => !a.includes(x))) {
    console.log(`  + ${cle} ${n}`);
    introduits++;
  }
  for (const d of a.filter((x) => !b.includes(x)))
    console.log(`  - ${cle} ${d} (corrigé)`);
}
console.log(
  introduits === 0
    ? '  aucun écart de contraste introduit'
    : `  ${introduits} ÉCART(S) INTRODUIT(S)`,
);

console.log('\n=== DÉBORDEMENTS 375 px ===');
console.log(`avant : ${avant.debordements.join(', ') || 'aucun'}`);
console.log(`après : ${apres.debordements.join(', ') || 'aucun'}`);

console.log('\n=== EMPREINTE DES STYLES CALCULÉS ===');
let compares = 0;
let ecarts = 0;
let reclasses = 0;
let apparus = 0;
let disparus = 0;
const details = [];

for (const vue of Object.keys(apres.empreintes ?? {})) {
  // Clé du balayage : « <chemin d'index>|<tag.classes> ». On indexe par CHEMIN
  // pour apparier un nœud dont la liste de classes a changé.
  const parChemin = (empreinte) =>
    Object.fromEntries(
      Object.entries(empreinte ?? {}).map(([k, v]) => {
        const sep = k.indexOf('|');
        return [k.slice(0, sep), [k.slice(sep + 1), v]];
      }),
    );
  const A = parChemin(avant.empreintes?.[vue]);
  const B = parChemin(apres.empreintes[vue]);

  for (const [chemin, [nomB, valB]] of Object.entries(B)) {
    const precedent = A[chemin];
    if (precedent === undefined) {
      apparus++;
      details.push(`  APPARU   ${vue} ${chemin} [${nomB}]`);
      continue;
    }
    const [nomA, valA] = precedent;
    compares++;
    if (nomA !== nomB) reclasses++;
    if (valA === valB) continue;
    ecarts++;
    const quoi = nomA === nomB ? 'DIFF' : 'DIFF↻';
    details.push(
      `  ${quoi}     ${vue} ${chemin}\n             [${nomA}] → [${nomB}]\n             ${diffProps(valA, valB).join('\n             ')}`,
    );
  }
  for (const chemin of Object.keys(A)) {
    if (!(chemin in B)) {
      disparus++;
      details.push(`  DISPARU  ${vue} ${chemin} [${A[chemin][0]}]`);
    }
  }
}

console.log(
  `${compares} nœud(s) comparés — ${ecarts} écart(s) de style, ` +
    `${reclasses} reclassé(s) (classes changées), ${apparus} apparu(s), ${disparus} disparu(s)`,
);
for (const d of details.slice(0, 60)) console.log(d);
if (details.length > 60) console.log(`  … et ${details.length - 60} autre(s)`);

if (ecarts === 0 && apparus === 0 && disparus === 0) {
  console.log(
    reclasses === 0
      ? '\nEMPREINTE IDENTIQUE — refactorisation à iso-rendu démontrée.'
      : `\nISO-RENDU DÉMONTRÉ — ${reclasses} nœud(s) ont changé de classes sans changer d'un seul style calculé.`,
  );
}

process.exit(ecarts > 0 || introduits > 0 ? 1 : 0);
