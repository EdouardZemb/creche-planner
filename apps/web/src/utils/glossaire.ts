// Glossaire des sigles métier — SOURCE DE VÉRITÉ UNIQUE pour leur libellé long.
// Consommé par la primitive `Abbr` (ui/Abbr.tsx) et par les écrans qui explicitent
// les sigles sur place (UT-08). Toute nouvelle abréviation s'ajoute ici, jamais en
// dur dans un composant, pour garantir la cohérence d'un écran à l'autre.

/** Table sigle → libellé long. Les clés sont les sigles tels qu'affichés. */
export const GLOSSAIRE = {
  RFR: 'Revenu fiscal de référence',
  PSU: 'Prestation de service unique',
  ABCM: 'Association des bénévoles pour la création de modes de garde',
  ALSH: 'Accueil de loisirs sans hébergement',
  PAI: "Projet d'accueil individualisé",
  PAJE: "Prestation d'accueil du jeune enfant",
} as const satisfies Record<string, string>;

/** Sigle reconnu par le glossaire (clé de `GLOSSAIRE`). */
export type Sigle = keyof typeof GLOSSAIRE;

/** Indique si une chaîne est un sigle connu du glossaire. */
export function estSigleConnu(sigle: string): sigle is Sigle {
  return Object.prototype.hasOwnProperty.call(GLOSSAIRE, sigle);
}

/**
 * Résout un sigle vers son libellé long.
 * Contrat : clé connue → libellé ; clé inconnue → `undefined`. Le composant
 * appelant décide du repli (afficher le sigle nu, par ex.).
 */
export function libelleSigle(sigle: string): string | undefined {
  return estSigleConnu(sigle) ? GLOSSAIRE[sigle] : undefined;
}
