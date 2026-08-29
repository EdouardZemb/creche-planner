/**
 * **Heures annuelles contractualisées : dérivation et plafond physique.**
 *
 * Les heures annuelles d'un contrat crèche PSU ne sont pas une donnée
 * indépendante : elles sont le produit de la **semaine type** et de la **période
 * de validité**, que le contrat porte déjà tous les deux. Les saisir à la main
 * *en plus* est une double saisie — et une double saisie que rien ne confronte
 * finit par diverger. C'est ce qui s'est produit en production : un contrat créé
 * depuis un compte parent porte 1607 h/an (la valeur proposée par défaut, qui est
 * la durée légale annuelle du *travail* en France et n'a aucun sens comme volume
 * de garde) pour une semaine type de 27 h, soit 59,5 semaines de garde. La
 * mensualisation (`heures / mensualités`) surfacturait d'autant.
 *
 * Le module rend donc **deux** services, à ne pas confondre :
 *
 * 1. **Dériver** une valeur à proposer — `heuresMaximalesSurPeriode` compte ce que
 *    la semaine type produit sur la période du contrat, fermetures exclues. C'est
 *    une **suggestion**, généreuse par construction.
 * 2. **Refuser** l'impossible — `coherenceHeuresAnnuelles` convertit la valeur en
 *    **semaines de garde équivalentes** (`heures / heures par semaine`) et rejette
 *    au-delà de **52** : un volume dit *annuel* ne peut pas demander plus de
 *    semaines qu'une année n'en contient. 1607 h à 27 h/semaine en réclame 59,5.
 *
 * Le refus porte volontairement sur l'**année**, et non sur la période du contrat.
 * Un premier jet bornait sur la période : il refusait alors le jeu de données de
 * référence du dépôt (`scripts/seed-demo.mjs`) et une spec e2e, c'est-à-dire la
 * convention établie du produit — les heures annuelles n'y sont pas re-proratisées
 * quand le contrat couvre sept mois. Une garde qui contredit la convention du
 * produit n'est pas une garde, c'est un changement de modèle déguisé. Celle-ci ne
 * dit qu'une chose, et elle est vraie partout : **une année a 52 semaines**.
 *
 * Il vit ici, et non dans `planification-domain`, pour une raison de frontière :
 * `context:web` ne peut dépendre que de `context:web` et `context:shared`. Une
 * règle hébergée dans le domaine planification aurait dû être **recopiée** côté
 * navigateur pour dériver la valeur du formulaire — c'est-à-dire reproduire, dans
 * le correctif lui-même, la duplication qui a causé le défaut. Le service et le
 * formulaire lisent donc la **même** fonction, sur la forme JSON que tous deux
 * manipulent déjà.
 *
 * **Ce que ce module ne couvre pas, et le dit :**
 * - il ne refuse **pas** une valeur seulement trop généreuse pour la période du
 *   contrat — seulement celle qui dépasse une année entière de garde. Resserrer
 *   demanderait de trancher d'abord si les heures annuelles se proratisent sur un
 *   contrat de sept mois : c'est une question de modèle, pas de garde-fou ;
 * - il ne connaît **pas** les fermetures réelles (calendrier d'établissement,
 *   SFD 31, non déployé) : la suggestion majore, elle n'ajuste pas ;
 * - il n'a **aucun avis** sur une semaine type **vide** (0 h/semaine) : c'est un
 *   défaut d'un autre ordre, et en faire une seconde garde déguisée serait sortir
 *   de son sujet.
 */

/** Une plage horaire de la semaine type, telle qu'elle est stockée et transmise. */
export interface PlageHeuresContrat {
  readonly debutHeures: number;
  readonly debutMinutes: number;
  readonly finHeures: number;
  readonly finMinutes: number;
}

/**
 * Semaine type : nom de jour (`LUNDI`…`DIMANCHE`) → plages horaires. Forme
 * **structurelle**, commune au JSON de la base, au DTO du service et au type du
 * formulaire : aucun des trois n'a besoin de convertir quoi que ce soit.
 */
export type SemaineTypeHeures = Readonly<
  Partial<Record<string, readonly PlageHeuresContrat[]>>
>;

/**
 * Période de validité d'un contrat : fin **incluse**, ou `null`/absente pour un
 * contrat sans terme (même convention que la colonne `contrat.valide_au`).
 */
export interface PeriodeValiditeContrat {
  readonly valideDu: string;
  readonly valideAu?: string | null;
}

/** Noms de jours, indexés comme `Date#getUTCDay` (0 = dimanche). */
const JOURS_PAR_INDEX = [
  'DIMANCHE',
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
] as const;

/** Les seuls index que `Date#getUTCDay` peut rendre. */
type IndexJour = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Nom du jour depuis l'index de `getUTCDay`. Le `% 7` n'est pas défensif : il
 * **prouve** au typage que l'index est dans le tuple, ce qui évite d'affirmer
 * l'évidence par un `!` — et une assertion de non-nullité serait ici un aveu que
 * le type ne décrit pas ce que le code sait déjà.
 */
function nomDuJour(indexUtc: number): string {
  return JOURS_PAR_INDEX[(indexUtc % 7) as IndexJour];
}

const FORMAT_ISO_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Arrondi au centième d'heure — même convention que la mensualisation (doc 02 §3.1). */
function arrondiCentiemeHeure(heures: number): number {
  return Math.round(heures * 100) / 100;
}

/** Minutes gardées sur une plage (0 si la plage est incohérente ou vide). */
function minutesDePlage(plage: PlageHeuresContrat): number {
  const debut = plage.debutHeures * 60 + plage.debutMinutes;
  const fin = plage.finHeures * 60 + plage.finMinutes;
  return Math.max(0, fin - debut);
}

/** Minutes gardées un jour nommé de la semaine type (somme de ses plages). */
function minutesDuJour(semaineType: SemaineTypeHeures, jour: string): number {
  const plages = semaineType[jour];
  if (plages === undefined) {
    return 0;
  }
  return plages.reduce((total, plage) => total + minutesDePlage(plage), 0);
}

/**
 * Heures gardées sur **une** semaine type complète. `0` si aucun jour n'est gardé.
 */
export function heuresHebdomadaires(semaineType: SemaineTypeHeures): number {
  return arrondiCentiemeHeure(
    JOURS_PAR_INDEX.reduce(
      (total, jour) => total + minutesDuJour(semaineType, jour),
      0,
    ) / 60,
  );
}

/**
 * Plafond d'heures que la semaine type peut produire sur la période, **fermetures
 * exclues** : on compte les occurrences réelles de chaque jour gardé entre
 * `valideDu` et `valideAu` (bornes incluses) et on somme leurs durées.
 *
 * Le comptage est fait jour par jour plutôt que par une formule « nombre de
 * semaines × heures hebdomadaires » : une période ne commence pas un lundi et ne
 * finit pas un dimanche, et c'est précisément aux deux bords qu'une telle formule
 * se trompe.
 *
 * Rend `null` pour une période **ouverte** (aucun plafond n'existe) et `0` pour
 * une période vide (fin avant début — l'incohérence de dates elle-même relève
 * d'INV-01, vérifiée par le domaine). Rend `null` sur une date malformée : ce
 * module ne juge pas le format des dates, et rendre un plafond faux serait pire
 * que ne rien rendre.
 */
export function heuresMaximalesSurPeriode(
  semaineType: SemaineTypeHeures,
  periode: PeriodeValiditeContrat,
): number | null {
  const fin = periode.valideAu;
  if (fin === undefined || fin === null) {
    return null;
  }
  if (!FORMAT_ISO_JOUR.test(periode.valideDu) || !FORMAT_ISO_JOUR.test(fin)) {
    return null;
  }
  if (fin < periode.valideDu) {
    return 0;
  }

  let minutes = 0;
  const dernier = Date.parse(`${fin}T00:00:00Z`);
  const curseur = new Date(`${periode.valideDu}T00:00:00Z`);
  if (Number.isNaN(dernier) || Number.isNaN(curseur.getTime())) {
    return null;
  }
  while (curseur.getTime() <= dernier) {
    minutes += minutesDuJour(semaineType, nomDuJour(curseur.getUTCDay()));
    curseur.setUTCDate(curseur.getUTCDate() + 1);
  }
  return arrondiCentiemeHeure(minutes / 60);
}

/**
 * Verdict de cohérence des heures annuelles face à la semaine type et la période.
 *
 * **Union discriminée** plutôt qu'un booléen et trois champs optionnels : quand le
 * verdict est négatif, un plafond existe forcément (c'est le seul cas qui peut
 * être dépassé) et le rythme hebdomadaire n'est pas nul. Le type le dit, donc
 * l'appelant n'a ni repli à écrire ni branche morte à couvrir.
 */
export type CoherenceHeuresAnnuelles =
  | {
      readonly coherent: true;
      readonly heuresHebdomadaires: number;
      /** `null` quand la semaine type est vide : aucune équivalence à calculer. */
      readonly semainesEquivalentes: number | null;
    }
  | {
      readonly coherent: false;
      readonly heuresHebdomadaires: number;
      /**
       * Semaines de garde qu'il faudrait pour atteindre la valeur saisie. C'est le
       * chiffre qui rend l'absurdité lisible : « 59,5 semaines » se comprend sans
       * calcul, « 1607 h » non. Toujours > {@link SEMAINES_PAR_AN} ici.
       */
      readonly semainesEquivalentes: number;
    };

/**
 * Semaines d'une année. Le seuil n'est pas un réglage : c'est un fait de
 * calendrier, et c'est ce qui rend le refus indiscutable.
 */
export const SEMAINES_PAR_AN = 52;

/**
 * Confronte des heures annuelles au rythme hebdomadaire saisi, et refuse ce qui
 * demanderait **plus de semaines qu'une année n'en contient**. La période du
 * contrat n'entre pas dans ce jugement — cf. l'en-tête du module.
 */
export function coherenceHeuresAnnuelles(
  semaineType: SemaineTypeHeures,
  heuresAnnuellesContractualisees: number,
): CoherenceHeuresAnnuelles {
  const hebdo = heuresHebdomadaires(semaineType);
  // Valeur absente ou non numérique (champ vide en cours de saisie) : ce module
  // n'a rien à en dire, et prétendre le contraire afficherait « NaN h » au
  // parent. Le caractère obligatoire du champ et la validation du domaine
  // (`ContratCreche.creer`, ≥ 0 et fini) traitent déjà ce cas. Semaine type vide :
  // aucune équivalence n'est calculable, donc aucun avis.
  if (!Number.isFinite(heuresAnnuellesContractualisees) || hebdo === 0) {
    return {
      coherent: true,
      heuresHebdomadaires: hebdo,
      semainesEquivalentes: null,
    };
  }
  const semainesEquivalentes = arrondiCentiemeHeure(
    heuresAnnuellesContractualisees / hebdo,
  );
  if (semainesEquivalentes <= SEMAINES_PAR_AN) {
    return { coherent: true, heuresHebdomadaires: hebdo, semainesEquivalentes };
  }
  return { coherent: false, heuresHebdomadaires: hebdo, semainesEquivalentes };
}

/** Nombre d'heures lisible : entier sans décimale, décimal avec virgule. */
function formaterHeures(heures: number): string {
  return Number.isInteger(heures)
    ? String(heures)
    : String(heures).replace('.', ',');
}

/**
 * Phrase destinée au **parent** quand la cohérence est en défaut : elle nomme les
 * trois chiffres qui font comprendre le refus (rythme hebdomadaire, plafond,
 * valeur saisie), sans sigle ni identifiant technique. Rend `null` quand il n'y a
 * rien à dire — l'appelant s'en sert comme test « faut-il refuser ? ».
 */
export function messageCoherenceHeures(
  verdict: CoherenceHeuresAnnuelles,
  heuresAnnuellesContractualisees: number,
): string | null {
  if (verdict.coherent) {
    return null;
  }
  return (
    `${formaterHeures(heuresAnnuellesContractualisees)} h à ` +
    `${formaterHeures(verdict.heuresHebdomadaires)} h par semaine représentent ` +
    `${formaterHeures(verdict.semainesEquivalentes)} semaines de garde, alors ` +
    `qu'une année n'en compte que ${String(SEMAINES_PAR_AN)}.`
  );
}
