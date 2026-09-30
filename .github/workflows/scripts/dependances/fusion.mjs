// @ts-check
/**
 * FUSION AUTOMATIQUE DES PR DEPENDABOT — exécuté par `dependabot-fusion.yml`.
 *
 * Ce script a le droit de fusionner dans `main` : il est traité comme du code
 * de sécurité. Ses garanties, dans l'ordre où elles jouent :
 *
 *   1. il ne tourne QUE sur `schedule` et `workflow_dispatch`, depuis `main` :
 *      aucun code, aucun workflow, aucune donnée d'une PR n'est exécuté ;
 *   2. il n'agit que si la variable de dépôt `FUSION_AUTO_DEPENDABOT` vaut
 *      exactement `active` — sinon il OBSERVE et rapporte, sans rien fusionner ;
 *   3. la décision vient de `tri.mjs` (politique + contrôles + avis) ;
 *   4. juste avant de fusionner, la PR est RELUE : si son commit de tête a
 *      bougé, on s'abstient ;
 *   5. la fusion passe le SHA évalué à l'API (`sha`) : GitHub la REFUSE si la
 *      branche a reçu un commit entre-temps — pas de fenêtre de course ;
 *   6. une seule fusion par passage : après elle, les autres PR sont en retard
 *      sur `main`, Dependabot les rebase et la CI repasse sur l'arbre réel.
 *
 * La protection de branche reste l'arbitre final : ce script ne la contourne
 * pas et ne le pourrait pas (jeton sans droit d'administration, pas de bypass).
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluer } from './evaluation.mjs';
import { client } from './github.mjs';
import { code, lien } from './markdown.mjs';
import { AUTEUR_DEPENDABOT } from './tri.mjs';

const LIBELLES = {
  prete: '✅ prête',
  securite: '🔐 sécurité — à ta main',
  'a-la-main': '✋ à ta main',
  attente: '⏳ en attente',
};

/**
 * @param {{
 *   api: import('./github.mjs').Client,
 *   depot: string,
 *   actif: boolean,
 *   ecrireResume: (md: string) => void,
 *   journal?: (msg: string) => void,
 * }} contexte
 * @returns {Promise<number>} code de sortie
 */
export async function executer({
  api,
  depot,
  actif,
  ecrireResume,
  journal = console.log,
}) {
  const listeR = await api.lister(
    `repos/${depot}/pulls?state=open&per_page=100&sort=created&direction=asc`,
  );
  if (!listeR.ok) {
    ecrireResume(
      `## Fusion Dependabot — POINT MORT\n\nListe des PR illisible (${listeR.statut}). Rien n'a été fusionné.\n`,
    );
    return 1;
  }
  const candidates = listeR.donnees.filter(
    (p) => p.user?.login === AUTEUR_DEPENDABOT,
  );

  /** @type {Awaited<ReturnType<typeof evaluer>>[]} */
  const verdicts = [];
  for (const p of candidates) {
    const detail = await api.lire(`repos/${depot}/pulls/${p.number}`);
    if (!detail.ok) {
      journal(
        `PR #${p.number} illisible (${detail.statut}) — ignorée ce passage`,
      );
      continue;
    }
    verdicts.push(await evaluer(api, depot, detail.donnees));
  }

  let codeSortie = 0;
  /** @type {string} */
  let action = actif
    ? 'Aucune PR prête ce passage.'
    : 'Mode OBSERVATION : la variable `FUSION_AUTO_DEPENDABOT` ne vaut pas `active`, rien ne sera fusionné.';

  const prete = verdicts.find((v) => v.decision === 'prete');
  if (prete && actif) {
    const relue = await api.lire(`repos/${depot}/pulls/${prete.numero}`);
    if (
      !relue.ok ||
      relue.donnees?.head?.sha !== prete.sha ||
      relue.donnees?.state !== 'open'
    ) {
      action = `PR #${prete.numero} : commit de tête changé ou PR relue en échec — abstention, réévaluation au prochain passage.`;
    } else {
      const fusion = await api.ecrire(
        'PUT',
        `repos/${depot}/pulls/${prete.numero}/merge`,
        {
          merge_method: 'squash',
          sha: prete.sha,
        },
      );
      if (fusion.ok) {
        action = `PR #${prete.numero} fusionnée (squash, commit ${prete.sha.slice(0, 7)}).`;
      } else {
        action = `PR #${prete.numero} : GitHub a REFUSÉ la fusion (${fusion.statut}). Rien n'a été forcé.`;
        codeSortie = 1;
      }
    }
  } else if (prete) {
    action += ` La PR #${prete.numero} aurait été fusionnée.`;
  }
  journal(action);

  const lignes = verdicts.map(
    (v) =>
      `| ${lien(`#${v.numero}`, v.url)} | ${LIBELLES[v.decision]} | ${v.dependances.length} | ${
        v.raisons.length === 0
          ? '—'
          : v.raisons
              .slice(0, 4)
              .map((r) => code(r, 160))
              .join('<br>')
      } |`,
  );
  ecrireResume(
    [
      '## Fusion Dependabot',
      '',
      `**Action** : ${action}`,
      '',
      verdicts.length === 0
        ? '_Aucune PR Dependabot ouverte._'
        : [
            '| PR | Décision | Dépendances | Raisons |',
            '| --- | --- | --- | --- |',
            ...lignes,
          ].join('\n'),
      '',
    ].join('\n'),
  );
  return codeSortie;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const jeton = process.env.GITHUB_TOKEN ?? '';
  const depot = process.env.GITHUB_REPOSITORY ?? '';
  const resume = process.env.GITHUB_STEP_SUMMARY;
  if (jeton === '' || !/^[\w.-]+\/[\w.-]+$/.test(depot)) {
    console.error('GITHUB_TOKEN ou GITHUB_REPOSITORY absent — arrêt.');
    process.exit(1);
  }
  const code = await executer({
    api: client(jeton, 'creche-planner-fusion-dependabot'),
    depot,
    // Égalité STRICTE : une valeur vide, « true », « Active » ou une faute de
    // frappe laissent l'automatisme en observation.
    actif: process.env.FUSION_AUTO_DEPENDABOT === 'active',
    ecrireResume: (md) => {
      if (resume) appendFileSync(resume, md);
      else console.log(md);
    },
  });
  process.exit(code);
}
