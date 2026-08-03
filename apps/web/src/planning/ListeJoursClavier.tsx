import { Bouton } from '../ui/Bouton';

/** Une ligne de la liste : tout est pré-calculé par le mode appelant. */
export interface LigneJourClavier {
  /** Date ISO « YYYY-MM-DD » — clé de liste et argument des rappels. */
  readonly date: string;
  /** Date formatée en français, affichée et reprise dans les `aria-label`. */
  readonly libelle: string;
  /** État du jour (« Gardé », « Réservé », « Demi-journée », « — »…). */
  readonly etat: string;
  /** Libellé du bouton d'action (« Saisir », « Modifier », « Ajuster »). */
  readonly action: string;
  /** `aria-label` du bouton : le libellé seul serait ambigu, répété par ligne. */
  readonly actionAriaLabel: string;
}

/** Multi-sélection optionnelle (saisie en lot du calendrier crèche). */
export interface SelectionJoursClavier {
  readonly estSelectionne: (date: string) => boolean;
  readonly onBasculer: (date: string) => void;
  readonly ariaLabel: (ligne: LigneJourClavier) => string;
}

export interface ListeJoursClavierProps {
  /** Intitulé du `<legend>` du groupe. */
  legende: string;
  jours: readonly LigneJourClavier[];
  onAction: (date: string) => void;
  /** Cases de sélection devant chaque date. Absente = liste en lecture simple. */
  selection?: SelectionJoursClavier | undefined;
  /**
   * Autorise la ligne à passer sur deux rangées. Réservé aux listes dont la
   * ligne est la plus chargée (date + case + état + bouton) : sous ~320 px, le
   * bouton passe alors sous la date au lieu de pousser le `fieldset` hors du
   * viewport. Les listes plus courtes restent sur une rangée — l'activer
   * partout changerait leur `flex-wrap` calculé sans raison.
   */
  retourLigne?: boolean;
}

/**
 * Alternative CLAVIER au calendrier : la même saisie que le clic sur une case
 * du mois, en liste tabulable. Les trois listes des calendriers mensuels
 * (absences crèche, journées ALSH, ajustements cantine/périscolaire) avaient
 * exactement ce balisage, dupliqué.
 *
 * Le composant ne dérive RIEN : il reçoit des lignes déjà libellées. C'est ce
 * qui lui permet d'être commun à des modes dont l'état affiché n'a pas la même
 * nature (une fenêtre horaire d'un côté, un booléen d'inscription de l'autre).
 */
export function ListeJoursClavier({
  legende,
  jours,
  onAction,
  selection,
  retourLigne = false,
}: ListeJoursClavierProps) {
  return (
    <fieldset style={{ marginTop: '1rem' }}>
      <legend>{legende}</legend>
      <ul className="liste-nue">
        {jours.map((ligne) => (
          <li
            key={ligne.date}
            style={{
              display: 'flex',
              alignItems: 'center',
              ...(retourLigne ? { flexWrap: 'wrap' as const } : {}),
              gap: '0.5rem',
              padding: '0.2rem 0',
            }}
          >
            {selection === undefined ? (
              <span style={{ minWidth: '8rem' }}>{ligne.libelle}</span>
            ) : (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={selection.estSelectionne(ligne.date)}
                  onChange={() => {
                    selection.onBasculer(ligne.date);
                  }}
                  aria-label={selection.ariaLabel(ligne)}
                />
                <span style={{ minWidth: '8rem' }}>{ligne.libelle}</span>
              </label>
            )}
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              {ligne.etat}
            </span>
            <Bouton
              variante="secondaire"
              onClick={() => {
                onAction(ligne.date);
              }}
              aria-label={ligne.actionAriaLabel}
            >
              {ligne.action}
            </Bouton>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
