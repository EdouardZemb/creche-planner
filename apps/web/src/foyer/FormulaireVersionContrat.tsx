import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  ContratLocal,
  ContratVue,
  JourSemaine,
  Mode,
  ParametresVersion,
  PlageHoraire,
  SemaineAbcm,
} from '../types/bff';
import {
  JOURS_SEMAINE_OUVRES,
  PlageEditor,
  AbcmEditor,
  AlshHebdoEditor,
  cochesDepuisSemaine,
  plagesDepuisSemaine,
  abcmDepuisSemaine,
  construireSemaineType,
  construireSemaineAbcmComplete,
} from './editeursSemaine';
import { extraireErreurs, messageErreur } from '../utils/erreurs';
import { estMode } from '../utils/libelles';
import { Abbr } from '../ui/Abbr';
import { Bouton, BoutonLien } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';
import { ModaleCorrection } from './ModaleCorrection';

/** Date du jour au format `YYYY-MM-DD` (fuseau local du navigateur). */
function aujourdhuiIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const jj = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear())}-${mm}-${jj}`;
}

export interface FormulaireVersionContratProps {
  foyerId: string;
  contrat: ContratLocal;
  /**
   * `avenant` : nouvelle version à une date d'effet future/passée (US-30-01).
   * `correction` : réécrit les paramètres de la version courante à sa date (US-30-05),
   * avec aperçu d'impact avant enregistrement.
   */
  variante: 'avenant' | 'correction';
  /** Version corrigée (requis pour `correction` ; ignoré pour un avenant). */
  versionId?: string;
  /** Succès : le contrat à jour est renvoyé (l'appelant recharge la liste). */
  onEnregistre: (c: ContratVue) => void;
  onAnnuler: () => void;
}

/**
 * Formulaire des **paramètres versionnés** d'un contrat (SFD 30, lot 5) : semaine type
 * (crèche) ou inscriptions hebdomadaires (ABCM/ALSH), heures et mensualités. Sert
 * l'avenant (« changer à partir d'une date ») et la correction (« corriger les paramètres
 * actuels »). **L'identité — enfant, mode, établissement — n'y figure JAMAIS (H6)** : elle
 * ne se versionne pas. Le `mode` est fixé (celui du contrat), sans sélecteur.
 */
export function FormulaireVersionContrat({
  foyerId,
  contrat,
  variante,
  versionId,
  onEnregistre,
  onAnnuler,
}: FormulaireVersionContratProps) {
  const mode: Mode = estMode(contrat.mode) ? contrat.mode : 'CRECHE_PSU';

  const [dateEffet, setDateEffet] = useState(aujourdhuiIso());
  const [heuresAnnuelles, setHeuresAnnuelles] = useState(
    contrat.heuresAnnuellesContractualisees !== undefined
      ? String(contrat.heuresAnnuellesContractualisees)
      : '1607',
  );
  const [nbMensualites, setNbMensualites] = useState(
    contrat.nbMensualites !== undefined ? String(contrat.nbMensualites) : '12',
  );
  const [cochesJours, setCochesJours] = useState<
    Partial<Record<JourSemaine, boolean>>
  >(() => cochesDepuisSemaine(contrat.semaineType));
  const [plagesJours, setPlagesJours] = useState<
    Partial<Record<JourSemaine, PlageHoraire>>
  >(() => plagesDepuisSemaine(contrat.semaineType));
  const [semaineAbcm, setSemaineAbcm] = useState<SemaineAbcm>(() =>
    abcmDepuisSemaine(contrat.semaineAbcm),
  );

  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  /** Assemble les paramètres versionnés (sans identité) à envoyer. */
  function construireParams(): ParametresVersion {
    if (mode === 'CRECHE_PSU') {
      return {
        mode: 'CRECHE_PSU',
        heuresAnnuellesContractualisees: parseFloat(heuresAnnuelles),
        nbMensualites: parseInt(nbMensualites, 10),
        semaineType: construireSemaineType(cochesJours, plagesJours),
      };
    }
    return { mode, semaineAbcm: construireSemaineAbcmComplete(semaineAbcm) };
  }

  /** Traduit une `ApiError` en message parent (409 = date déjà prise, etc.). */
  function messageDepuisErreur(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return 'Un changement existe déjà à cette date. Choisissez une autre date de début.';
      }
      const champs = extraireErreurs(err.corps);
      if (champs.length > 0) {
        return champs.map((c) => c.message).join(' ');
      }
    }
    return messageErreur(err);
  }

  async function creerAvenant(ev: FormEvent) {
    ev.preventDefault();
    setChargement(true);
    setErreur(null);
    try {
      const contratMaj = await api.creerAvenant(contrat.id, {
        ...construireParams(),
        dateEffet,
      });
      onEnregistre(contratMaj);
    } catch (err) {
      setErreur(messageDepuisErreur(err));
    } finally {
      setChargement(false);
    }
  }

  async function corriger(motif: string | undefined) {
    if (versionId === undefined) return;
    setChargement(true);
    setErreur(null);
    try {
      const contratMaj = await api.corrigerVersion(contrat.id, versionId, {
        ...construireParams(),
        ...(motif !== undefined ? { motif } : {}),
      });
      setConfirmationOuverte(false);
      onEnregistre(contratMaj);
    } catch (err) {
      setErreur(messageDepuisErreur(err));
    } finally {
      setChargement(false);
    }
  }

  const editeursParametres =
    mode === 'CRECHE_PSU' ? (
      <>
        <label htmlFor="version-heures">
          Heures annuelles contractualisées
        </label>
        <input
          id="version-heures"
          type="number"
          min="1"
          step="0.5"
          value={heuresAnnuelles}
          onChange={(e) => {
            setHeuresAnnuelles(e.target.value);
          }}
          style={{ width: '100%' }}
        />

        <label htmlFor="version-mensualites">Nombre de mensualités</label>
        <input
          id="version-mensualites"
          type="number"
          min="1"
          max="12"
          step="1"
          value={nbMensualites}
          onChange={(e) => {
            setNbMensualites(e.target.value);
          }}
          style={{ width: '100%' }}
        />

        <fieldset style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Semaine type (jours et horaires)
          </legend>
          {JOURS_SEMAINE_OUVRES.map((jour) => {
            const plage = plagesJours[jour] ?? {
              debutHeures: 8,
              debutMinutes: 0,
              finHeures: 17,
              finMinutes: 30,
            };
            return (
              <PlageEditor
                key={jour}
                jour={jour}
                coche={cochesJours[jour] === true}
                plage={plage}
                onCoche={(val) => {
                  setCochesJours((prev) => {
                    const n = { ...prev };
                    if (val) {
                      n[jour] = true;
                    } else {
                      delete n[jour];
                    }
                    return n;
                  });
                }}
                onPlage={(p) => {
                  setPlagesJours((prev) => ({ ...prev, [jour]: p }));
                }}
              />
            );
          })}
        </fieldset>
      </>
    ) : (
      <fieldset style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}>
        <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
          Inscriptions hebdomadaires
        </legend>
        {mode === 'ALSH' ? (
          <>
            <p className="muted" style={{ margin: '0 0 0.5rem' }}>
              Cochez les jours d’accueil de loisirs (<Abbr sigle="ALSH" />)
              réguliers, chaque semaine.
            </p>
            <AlshHebdoEditor
              semaineAbcm={semaineAbcm}
              onChange={setSemaineAbcm}
            />
          </>
        ) : (
          <AbcmEditor
            mode={mode}
            semaineAbcm={semaineAbcm}
            onChange={setSemaineAbcm}
          />
        )}
      </fieldset>
    );

  if (variante === 'correction') {
    return (
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          setConfirmationOuverte(true);
        }}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Corrige les paramètres <strong>actuels</strong> du contrat, sans
          changer leur date de début. Les mois déjà enregistrés seront
          recalculés.
        </p>
        {editeursParametres}
        {!confirmationOuverte && <ChampErreur balise="p">{erreur}</ChampErreur>}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <Bouton type="submit">Voir l’impact et corriger</Bouton>
          <Bouton variante="secondaire" onClick={onAnnuler}>
            Annuler
          </Bouton>
        </div>
        {confirmationOuverte && versionId !== undefined && (
          <ModaleCorrection
            contratId={contrat.id}
            versionId={versionId}
            enregistrement={chargement}
            erreur={erreur}
            onConfirmer={(motif) => void corriger(motif)}
            onAnnuler={() => {
              setConfirmationOuverte(false);
              setErreur(null);
            }}
          />
        )}
      </form>
    );
  }

  return (
    <form onSubmit={(ev) => void creerAvenant(ev)}>
      <p className="muted" style={{ marginTop: 0 }}>
        Enregistre un changement <strong>à partir d’une date</strong> : les mois
        d’avant gardent leurs paramètres actuels, ceux à partir de cette date
        prennent les nouveaux.
      </p>

      <label htmlFor="version-date-effet">À partir du</label>
      <input
        id="version-date-effet"
        type="date"
        required
        aria-required="true"
        value={dateEffet}
        onChange={(e) => {
          setDateEffet(e.target.value);
        }}
        style={{ width: '100%' }}
      />

      {editeursParametres}

      <ChampErreur balise="p">{erreur}</ChampErreur>

      <div
        style={{
          marginTop: '1rem',
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <Bouton type="submit" disabled={chargement}>
          {chargement ? 'Enregistrement…' : 'Enregistrer le changement'}
        </Bouton>
        <BoutonLien
          to={`/foyers/${foyerId}/couts?simule=true`}
          variante="secondaire"
        >
          Simuler l’impact sur les coûts
        </BoutonLien>
        <Bouton variante="secondaire" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
