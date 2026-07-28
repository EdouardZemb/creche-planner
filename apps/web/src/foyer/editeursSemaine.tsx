import type {
  JourSemaine,
  PlageHoraire,
  SemaineTypeCreche,
  SemaineAbcm,
  InscriptionsJour,
  JourAlshHebdo,
} from '../types/bff';
import { JOURS_SEMAINE, LIBELLES_JOURS } from '../utils/dates';

/**
 * Éditeurs **partagés** de la semaine type (crèche) et de la semaine d'inscriptions
 * (ABCM/ALSH) d'un contrat, extraits de `ContratForm` pour être réutilisés par le
 * formulaire d'avenant/correction (SFD 30, lot 5). Purement présentationnels et
 * contrôlés : aucun état propre, aucun fetch — l'orchestration (valeurs + persistance)
 * reste chez l'appelant.
 */

/** Jours ouvrés (lundi → vendredi), seuls proposés à l'édition d'une semaine. */
export const JOURS_SEMAINE_OUVRES: JourSemaine[] = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
];

// Champs booléens de la table cantine/périscolaire (l'ALSH hebdomadaire a son
// éditeur dédié, `AlshHebdoEditor`, car il porte une formule + repas).
type ChampInscription = 'cantine' | 'periMatin' | 'periSoir';

// ---- Éditeur de plage horaire (CRECHE_PSU) -----------------------------------

export interface PlageEditorProps {
  jour: JourSemaine;
  coche: boolean;
  plage: PlageHoraire;
  onCoche: (coche: boolean) => void;
  onPlage: (plage: PlageHoraire) => void;
}

export function PlageEditor({
  jour,
  coche,
  plage,
  onCoche,
  onPlage,
}: PlageEditorProps) {
  function toTime(h: number, m: number): string {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function fromTime(val: string): { heures: number; minutes: number } {
    const parts = val.split(':');
    return {
      heures: parseInt(parts[0] ?? '0', 10),
      minutes: parseInt(parts[1] ?? '0', 10),
    };
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: '0.4rem',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          margin: 0,
          minWidth: 90,
        }}
      >
        <input
          type="checkbox"
          checked={coche}
          onChange={(e) => {
            onCoche(e.target.checked);
          }}
        />
        {LIBELLES_JOURS[jour]}
      </label>
      {coche && (
        <>
          <label style={{ margin: 0, fontSize: '0.85rem', color: 'inherit' }}>
            Début
            <input
              type="time"
              value={toTime(plage.debutHeures, plage.debutMinutes)}
              onChange={(e) => {
                const { heures, minutes } = fromTime(e.target.value);
                onPlage({
                  ...plage,
                  debutHeures: heures,
                  debutMinutes: minutes,
                });
              }}
              style={{ marginLeft: '0.3rem' }}
            />
          </label>
          <label style={{ margin: 0, fontSize: '0.85rem', color: 'inherit' }}>
            Fin
            <input
              type="time"
              value={toTime(plage.finHeures, plage.finMinutes)}
              onChange={(e) => {
                const { heures, minutes } = fromTime(e.target.value);
                onPlage({ ...plage, finHeures: heures, finMinutes: minutes });
              }}
              style={{ marginLeft: '0.3rem' }}
            />
          </label>
        </>
      )}
    </div>
  );
}

// ---- Éditeur semaine ABCM (CANTINE/PERISCOLAIRE) -----------------------------

export interface AbcmEditorProps {
  mode: 'CANTINE' | 'PERISCOLAIRE';
  semaineAbcm: SemaineAbcm;
  onChange: (s: SemaineAbcm) => void;
}

export function AbcmEditor({ mode, semaineAbcm, onChange }: AbcmEditorProps) {
  const montrerCantine = mode === 'CANTINE' || mode === 'PERISCOLAIRE';
  const montrerPeriMatin = mode === 'PERISCOLAIRE';
  const montrerPeriSoir = mode === 'PERISCOLAIRE';

  function inscriptionJour(jour: JourSemaine): InscriptionsJour {
    return semaineAbcm[jour] ?? {};
  }

  function mettreAJour(
    jour: JourSemaine,
    champ: ChampInscription,
    val: boolean,
  ) {
    const actuel = inscriptionJour(jour);
    const suivant: InscriptionsJour = { ...actuel };
    if (val) {
      suivant[champ] = true;
    } else {
      delete suivant[champ];
    }
    const nouveauJour = Object.keys(suivant).length === 0 ? undefined : suivant;
    const nouvelleAbcm: SemaineAbcm = { ...semaineAbcm };
    if (nouveauJour === undefined) {
      delete nouvelleAbcm[jour];
    } else {
      nouvelleAbcm[jour] = nouveauJour;
    }
    onChange(nouvelleAbcm);
  }

  return (
    <div className="table-defilante">
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          fontSize: '0.9rem',
        }}
      >
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', paddingRight: '1rem' }}>
              Jour
            </th>
            {montrerCantine && <th scope="col">Cantine</th>}
            {montrerPeriMatin && <th scope="col">Péri matin</th>}
            {montrerPeriSoir && <th scope="col">Péri soir</th>}
          </tr>
        </thead>
        <tbody>
          {JOURS_SEMAINE_OUVRES.map((jour) => {
            const insc = inscriptionJour(jour);
            return (
              <tr key={jour}>
                <th
                  scope="row"
                  style={{ textAlign: 'left', paddingRight: '1rem' }}
                >
                  {LIBELLES_JOURS[jour]}
                </th>
                {montrerCantine && (
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={insc.cantine === true}
                      onChange={(e) => {
                        mettreAJour(jour, 'cantine', e.target.checked);
                      }}
                      aria-label={`Cantine ${LIBELLES_JOURS[jour]}`}
                    />
                  </td>
                )}
                {montrerPeriMatin && (
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={insc.periMatin === true}
                      onChange={(e) => {
                        mettreAJour(jour, 'periMatin', e.target.checked);
                      }}
                      aria-label={`Périscolaire matin ${LIBELLES_JOURS[jour]}`}
                    />
                  </td>
                )}
                {montrerPeriSoir && (
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={insc.periSoir === true}
                      onChange={(e) => {
                        mettreAJour(jour, 'periSoir', e.target.checked);
                      }}
                      aria-label={`Périscolaire soir ${LIBELLES_JOURS[jour]}`}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Éditeur ALSH hebdomadaire (jours récurrents : formule + repas) ----------

export interface AlshHebdoEditorProps {
  semaineAbcm: SemaineAbcm;
  onChange: (s: SemaineAbcm) => void;
}

/**
 * Inscription ALSH **récurrente** par jour de semaine : cocher un jour déclare
 * l'enfant présent chaque semaine ce jour-là (formule journée/demi + repas),
 * miroir de `InscriptionsJour.alsh` côté domaine. Les jours de vacances se
 * réservent par date depuis le planning (`joursAlsh`), en complément.
 */
export function AlshHebdoEditor({
  semaineAbcm,
  onChange,
}: AlshHebdoEditorProps) {
  function mettreAJour(jour: JourSemaine, alsh: JourAlshHebdo | undefined) {
    const nouvelleAbcm: SemaineAbcm = { ...semaineAbcm };
    if (alsh === undefined) {
      delete nouvelleAbcm[jour];
    } else {
      nouvelleAbcm[jour] = { alsh };
    }
    onChange(nouvelleAbcm);
  }

  return (
    <>
      {JOURS_SEMAINE_OUVRES.map((jour) => {
        const config = semaineAbcm[jour]?.alsh;
        return (
          <div
            key={jour}
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '0.4rem',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                margin: 0,
                minWidth: 90,
              }}
            >
              <input
                type="checkbox"
                checked={config !== undefined}
                onChange={(e) => {
                  mettreAJour(
                    jour,
                    e.target.checked ? { type: 'COMPLETE' } : undefined,
                  );
                }}
                aria-label={`ALSH ${LIBELLES_JOURS[jour]}`}
              />
              {LIBELLES_JOURS[jour]}
            </label>
            {config && (
              <>
                <select
                  value={config.type}
                  onChange={(e) => {
                    mettreAJour(jour, {
                      ...config,
                      type: e.target.value === 'DEMI' ? 'DEMI' : 'COMPLETE',
                    });
                  }}
                  aria-label={`Formule ${LIBELLES_JOURS[jour]}`}
                >
                  <option value="COMPLETE">Journée complète</option>
                  <option value="DEMI">Demi-journée</option>
                </select>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    margin: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={config.repas === true}
                    onChange={(e) => {
                      mettreAJour(jour, {
                        type: config.type,
                        ...(e.target.checked ? { repas: true } : {}),
                      });
                    }}
                    aria-label={`Repas ${LIBELLES_JOURS[jour]}`}
                  />
                  Repas
                </label>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---- Helpers d'initialisation / (dé)sérialisation ---------------------------

/** Coches initiales de la semaine type : jours portant au moins une plage. */
export function cochesDepuisSemaine(
  semaine: SemaineTypeCreche | undefined,
): Partial<Record<JourSemaine, boolean>> {
  if (!semaine) {
    return { LUNDI: true, MARDI: true, JEUDI: true, VENDREDI: true };
  }
  const coches: Partial<Record<JourSemaine, boolean>> = {};
  for (const jour of JOURS_SEMAINE_OUVRES) {
    if ((semaine[jour]?.length ?? 0) > 0) {
      coches[jour] = true;
    }
  }
  return coches;
}

/** Plages initiales de la semaine type (1ʳᵉ plage de chaque jour gardé). */
export function plagesDepuisSemaine(
  semaine: SemaineTypeCreche | undefined,
): Partial<Record<JourSemaine, PlageHoraire>> {
  const p: Partial<Record<JourSemaine, PlageHoraire>> = {};
  for (const jour of JOURS_SEMAINE_OUVRES) {
    const premiere = semaine?.[jour]?.[0];
    p[jour] = premiere ?? {
      debutHeures: 8,
      debutMinutes: 0,
      finHeures: 17,
      finMinutes: 30,
    };
  }
  return p;
}

/** Inscriptions ABCM initiales (jours ouvrés seulement, pour l'éditeur). */
export function abcmDepuisSemaine(
  semaine: SemaineAbcm | undefined,
): SemaineAbcm {
  if (!semaine) {
    return {};
  }
  const s: SemaineAbcm = {};
  for (const jour of JOURS_SEMAINE_OUVRES) {
    const insc = semaine[jour];
    if (insc && Object.keys(insc).length > 0) {
      s[jour] = insc;
    }
  }
  return s;
}

/**
 * Construit la semaine type COMPLÈTE (7 jours présents) attendue par
 * svc-planification : tableau de plages pour un jour gardé, tableau vide sinon
 * (sinon 400 « expected array, received undefined »).
 */
export function construireSemaineType(
  cochesJours: Partial<Record<JourSemaine, boolean>>,
  plagesJours: Partial<Record<JourSemaine, PlageHoraire>>,
): SemaineTypeCreche {
  const s: SemaineTypeCreche = {};
  for (const jour of JOURS_SEMAINE) {
    const plage = plagesJours[jour];
    s[jour] = cochesJours[jour] && plage ? [plage] : [];
  }
  return s;
}

/** Idem ABCM : les 7 jours présents, objet vide pour un jour sans inscription. */
export function construireSemaineAbcmComplete(
  semaineAbcm: SemaineAbcm,
): SemaineAbcm {
  const s: SemaineAbcm = {};
  for (const jour of JOURS_SEMAINE) {
    s[jour] = semaineAbcm[jour] ?? {};
  }
  return s;
}
