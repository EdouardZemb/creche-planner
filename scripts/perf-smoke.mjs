#!/usr/bin/env node
// @ts-check
/**
 * Smoke de PERFORMANCE sur `/api/v1/couts/annuel` (doc 18 §8, action P2-6 ; doc 23).
 *
 * Garde anti-régression de la latence de l'agrégation annuelle — la route la plus
 * coûteuse (12 mois agrégés). Un défaut de sérialisation y avait fait passer la latence
 * de ~0,93 s à ~7 s / 502 (doc 06 §19.7) : ce smoke en fait une régression DÉTECTABLE.
 *
 * Méthode : après amorçage (seed), on envoie `REQUESTS` requêtes par vagues de
 * `CONCURRENCY` requêtes simultanées (reproduit le scénario réel des polls navigateur /
 * specs E2E concurrents), on mesure les latences et on calcule p50/p95/p99.
 *
 * Deux seuils distincts (doc 23 §2) :
 *   - **SLO produit cible** : p95 ≈ 1 000 ms (≈ 0,93 s mesuré, doc 06 §19.7) — objectif.
 *   - **Plafond CI bloquant** (`PERF_SLO_P95_MS`, défaut 3000) : garde-fou anti-régression
 *     tolérant à la variance des runners partagés ; échoue sur la classe de régression
 *     multi-secondes (le bug d'origine), pas sur du bruit de ±200 ms.
 *
 * Zéro dépendance (Node ESM pur). Lit `foyerId` depuis scripts/.seed-demo-state.json.
 * Écrit un résumé dans GITHUB_STEP_SUMMARY si présent. Code de sortie ≠ 0 si une requête
 * n'est pas 200 ou si p95 dépasse le plafond CI.
 */

import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const ANNEE = process.env.PERF_ANNEE ?? '2026';
const REQUESTS = Number(process.env.PERF_REQUESTS ?? '30');
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? '12');
const CEIL_P95 = Number(process.env.PERF_SLO_P95_MS ?? '3000');
const TARGET_P95 = 1000; // SLO produit documenté (≈ 0,93 s mesuré, doc 06 §19.7)

/** Lit l'id du foyer amorcé. */
function foyerId() {
  const etat = JSON.parse(
    readFileSync(join(RACINE, 'scripts', '.seed-demo-state.json'), 'utf8'),
  );
  if (!etat.foyerId) throw new Error('foyerId absent de .seed-demo-state.json');
  return etat.foyerId;
}

const url = (foyer) =>
  `${BASE}/api/v1/couts/annuel?foyer=${foyer}&annee=${ANNEE}`;

/** Une requête chronométrée → { ok, status, ms }. */
async function mesurer(u) {
  const t0 = performance.now();
  try {
    const r = await fetch(u);
    await r.arrayBuffer(); // vider le corps pour une mesure complète
    return { ok: r.ok, status: r.status, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, err: e.message };
  }
}

/** Attend que la projection soit chaude (200) avant de mesurer (eventual consistency NATS). */
async function attendrePrete(u) {
  for (let i = 0; i < 20; i++) {
    const r = await mesurer(u);
    if (r.ok) return;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(
    `La route annuelle ne répond pas 200 après 20 tentatives : ${u}`,
  );
}

/** Percentile (interpolation au plus proche) sur un tableau trié. */
function pct(triees, p) {
  if (triees.length === 0) return 0;
  const i = Math.min(
    triees.length - 1,
    Math.ceil((p / 100) * triees.length) - 1,
  );
  return triees[i];
}

async function main() {
  const foyer = foyerId();
  const u = url(foyer);
  console.log(`▶ Smoke perf sur ${u}`);
  console.log(
    `  ${REQUESTS} requêtes, ${CONCURRENCY} simultanées · plafond CI p95 ≤ ${CEIL_P95} ms`,
  );

  await attendrePrete(u);

  const latences = [];
  let echecs = 0;
  for (let envoyees = 0; envoyees < REQUESTS; envoyees += CONCURRENCY) {
    const taille = Math.min(CONCURRENCY, REQUESTS - envoyees);
    const lot = await Promise.all(
      Array.from({ length: taille }, () => mesurer(u)),
    );
    for (const r of lot) {
      latences.push(r.ms);
      if (!r.ok) {
        echecs++;
        console.error(
          `  ✗ status=${r.status}${r.err ? ` (${r.err})` : ''} en ${r.ms.toFixed(0)} ms`,
        );
      }
    }
  }

  const triees = [...latences].sort((a, b) => a - b);
  const p50 = pct(triees, 50);
  const p95 = pct(triees, 95);
  const p99 = pct(triees, 99);
  const max = triees[triees.length - 1] ?? 0;
  const fmt = (n) => `${n.toFixed(0)} ms`;

  const lignes = [
    '## ⏱️ Smoke performance — `/api/v1/couts/annuel`',
    '',
    `| Métrique | Valeur |`,
    `| --- | ---: |`,
    `| Requêtes (concurrence) | ${REQUESTS} (${CONCURRENCY}) |`,
    `| Échecs (non-200) | ${echecs} |`,
    `| p50 | ${fmt(p50)} |`,
    `| **p95** | **${fmt(p95)}** |`,
    `| p99 | ${fmt(p99)} |`,
    `| max | ${fmt(max)} |`,
    `| SLO produit cible (p95) | ${fmt(TARGET_P95)} (≈ 0,93 s) |`,
    `| Plafond CI bloquant (p95) | ${fmt(CEIL_P95)} |`,
  ];
  const resume = lignes.join('\n') + '\n';
  process.stdout.write('\n' + resume);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, resume);

  if (echecs > 0) {
    console.error(`\n❌ ${echecs} requête(s) non-200 sur la route annuelle.`);
    process.exit(1);
  }
  if (p95 > CEIL_P95) {
    console.error(
      `\n❌ Régression de latence : p95 ${fmt(p95)} > plafond ${fmt(CEIL_P95)}.`,
    );
    process.exit(1);
  }
  if (p95 > TARGET_P95) {
    console.warn(
      `\n⚠️ p95 ${fmt(p95)} au-dessus du SLO cible ${fmt(TARGET_P95)} (sous le plafond CI — non bloquant).`,
    );
  }
  console.log(
    `\n✅ Smoke perf OK — p95 ${fmt(p95)} ≤ plafond ${fmt(CEIL_P95)}.`,
  );
}

main().catch((e) => {
  console.error(`\n❌ Échec du smoke perf : ${e.message}`);
  process.exit(1);
});
