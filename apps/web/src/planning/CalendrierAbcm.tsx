import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventInput } from '@fullcalendar/core';
import { api } from '../api/client';
import type {
  ContratLocal,
  JourAlsh,
  ExceptionAbcm,
  CreerContratAbcm,
  InscriptionsJour,
} from '../types/bff';
import { joursDuMois, jourSemaineDeIso, formaterDateFr } from '../utils/dates';
import { couleurDuMode } from '../utils/couleurs';
import { messageErreur } from '../utils/erreurs';
import { Modale } from '../ui/Modale';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { StatutSauvegarde } from '../ui/StatutSauvegarde';
import { useAnnonce } from '../hooks/useAnnonce';
import { usePlanning } from './usePlanning';
import { useSaisieServeur } from './useSaisieServeur';
import { LegendePlanning } from './LegendePlanning';
import { ChoixPortee, type Portee } from './ChoixPortee';
import { couleurAjoute, couleurRetire } from './couleursPlanning';

export interface CalendrierAbcmProps {
  contrat: ContratLocal;
  mois: string;
  simule: boolean;
  onEnregistre: () => void;
  /** Appelé après une modification durable du contrat (recharge nécessaire). */
  onContratModifie?: () => void;
}

interface EtatAlsh {
  date: string;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

/** Inscriptions effectives d'un jour (matin/soir/cantine) après exception. */
interface Effectif {
  cantine: boolean;
  matin: boolean;
  soir: boolean;
}

/** Calendrier mensuel ABCM (CANTINE, PERISCOLAIRE, ALSH). */
export function CalendrierAbcm({
  contrat,
  mois,
  simule,
  onEnregistre,
  onContratModifie,
}: CalendrierAbcmProps) {
  const { etat, erreur, ecrire } = usePlanning(onEnregistre);
  const mode = contrat.mode as 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';

  // AQ-05 : région live annonçant chaque mutation du calendrier aux lecteurs
  // d'écran (la sauvegarde est différée de 800 ms, le retour visuel ne suffit pas).
  const { annoncer, regionLiveProps } = useAnnonce();

  const { saisie: saisieServeur, chargee } = useSaisieServeur(
    contrat.id,
    mois,
    simule,
  );

  const [pai, setPai] = useState<boolean | undefined>(undefined);
  const [joursAlsh, setJoursAlsh] = useState<EtatAlsh[]>([]);
  // Ajustements ponctuels par date (CANTINE / PERISCOLAIRE).
  const [exceptions, setExceptions] = useState<ExceptionAbcm[]>([]);

  // Réhydratation depuis le serveur (source de vérité, durabilité multi-poste).
  useEffect(() => {
    setPai(undefined);
    setJoursAlsh([]);
    setExceptions([]);
  }, [contrat.id, mois, simule]);

  // Si le serveur ne renvoie aucune saisie, on conserve l'état local (brouillon
  // ou saisie en cours) plutôt que de l'effacer.
  useEffect(() => {
    if (!chargee || saisieServeur === null) return;
    setPai(saisieServeur.pai);
    setExceptions(saisieServeur.exceptions ?? []);
    setJoursAlsh(
      (saisieServeur.joursAlsh ?? []).map((j) => ({
        date: j.date,
        type: j.type,
        repas: j.repas ?? false,
      })),
    );
  }, [chargee, saisieServeur]);

  // Modale ALSH.
  const [popoverDate, setPopoverDate] = useState<string | null>(null);
  const [popoverForm, setPopoverForm] = useState<{
    type: 'COMPLETE' | 'DEMI';
    repas: boolean;
  }>({ type: 'COMPLETE', repas: false });

  // Modale ajustement cantine/péri.
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [dialogForm, setDialogForm] = useState<{
    cantine: boolean;
    matin: boolean;
    soir: boolean;
  }>({ cantine: false, matin: false, soir: false });
  const [portee, setPortee] = useState<Portee>('mois');

  // Confirmation d'une modification durable du contrat.
  const [confirmationDurable, setConfirmationDurable] = useState<{
    semaineAbcm: ContratLocal['semaineAbcm'];
    message: string;
  } | null>(null);
  // Erreur d'une modification durable (PUT contrat) : affichée sans détruire
  // l'état local. L'opération est atomique côté service et un 429 est rejeté
  // par la gateway avant tout effet → le contrat reste intact.
  const [erreurDurable, setErreurDurable] = useState<string | null>(null);

  const semaineAbcm = contrat.semaineAbcm ?? {};

  const estDansPeriode = useCallback(
    (iso: string): boolean =>
      iso >= contrat.valideDu &&
      (contrat.valideAu === null || iso <= contrat.valideAu),
    [contrat.valideDu, contrat.valideAu],
  );

  const inscriptionsTemplate = useCallback(
    (iso: string): InscriptionsJour => semaineAbcm[jourSemaineDeIso(iso)] ?? {},
    [semaineAbcm],
  );

  const exceptionDe = useCallback(
    (iso: string): ExceptionAbcm | undefined =>
      exceptions.find((e) => e.date === iso),
    [exceptions],
  );

  const effectif = useCallback(
    (iso: string): Effectif => {
      const t = inscriptionsTemplate(iso);
      const e = exceptionDe(iso);
      return {
        cantine: e?.cantine ?? t.cantine ?? false,
        matin: e?.periMatin ?? t.periMatin ?? false,
        soir: e?.periSoir ?? t.periSoir ?? false,
      };
    },
    [inscriptionsTemplate, exceptionDe],
  );

  // Jours d'école du mois (dans la période) — base des ajustements cantine/péri.
  const joursPeriode = useMemo<string[]>(() => {
    if (mode === 'ALSH') return [];
    return joursDuMois(mois).filter(estDansPeriode);
  }, [mode, mois, estDansPeriode]);

  const couleur = couleurDuMode(mode);
  const couleurAjout = couleurAjoute();
  const couleurRet = couleurRetire();

  // Écart net vs contrat (jours actifs ajoutés − jours actifs retirés).
  const ecartJours = useMemo(() => {
    if (mode === 'ALSH') return 0;
    let ajoutes = 0;
    let retires = 0;
    for (const iso of joursPeriode) {
      const t = inscriptionsTemplate(iso);
      const eff = effectif(iso);
      const tActif =
        mode === 'CANTINE'
          ? (t.cantine ?? false)
          : (t.periMatin ?? false) || (t.periSoir ?? false);
      const effActif = mode === 'CANTINE' ? eff.cantine : eff.matin || eff.soir;
      if (effActif && !tActif) ajoutes += 1;
      if (!effActif && tActif) retires += 1;
    }
    return ajoutes - retires;
  }, [mode, joursPeriode, inscriptionsTemplate, effectif]);

  const events = useMemo<EventInput[]>(() => {
    if (mode === 'ALSH') {
      return joursAlsh.map((j) => ({
        id: j.date,
        start: j.date,
        allDay: true,
        backgroundColor: couleur,
        borderColor: couleur,
        title:
          j.type === 'COMPLETE'
            ? j.repas
              ? 'Journée + repas'
              : 'Journée'
            : 'Demi-journée',
      }));
    }

    const evts: EventInput[] = [];
    for (const iso of joursPeriode) {
      const t = inscriptionsTemplate(iso);
      const eff = effectif(iso);
      if (mode === 'CANTINE') {
        const tActif = t.cantine ?? false;
        if (eff.cantine && !tActif) {
          evts.push(evt(iso, couleurAjout, 'Ajouté'));
        } else if (eff.cantine && tActif) {
          evts.push(evt(iso, couleur, 'Cantine'));
        } else if (!eff.cantine && tActif) {
          evts.push(evt(iso, couleurRet, 'Retiré'));
        }
      } else {
        const tActif = (t.periMatin ?? false) || (t.periSoir ?? false);
        const effActif = eff.matin || eff.soir;
        const change =
          eff.matin !== (t.periMatin ?? false) ||
          eff.soir !== (t.periSoir ?? false);
        const titre =
          eff.matin && eff.soir ? 'Matin + soir' : eff.matin ? 'Matin' : 'Soir';
        if (effActif) {
          evts.push(evt(iso, change ? couleurAjout : couleur, titre));
        } else if (tActif) {
          evts.push(evt(iso, couleurRet, 'Retiré'));
        }
      }
    }
    return evts;
  }, [
    mode,
    joursAlsh,
    joursPeriode,
    inscriptionsTemplate,
    effectif,
    couleur,
    couleurAjout,
    couleurRet,
  ]);

  const joursDuMoisListe = useMemo<string[]>(
    () => (mode === 'ALSH' ? joursDuMois(mois) : joursPeriode),
    [mode, mois, joursPeriode],
  );

  const envoyer = useCallback(
    (
      nvJoursAlsh: EtatAlsh[],
      nvPai: boolean | undefined,
      nvExceptions: ExceptionAbcm[],
    ) => {
      if (mode === 'CANTINE') {
        ecrire(contrat.id, mois, simule, {
          ...(nvPai !== undefined ? { pai: nvPai } : {}),
          ...(nvExceptions.length > 0 ? { exceptions: nvExceptions } : {}),
        });
      } else if (mode === 'PERISCOLAIRE') {
        ecrire(contrat.id, mois, simule, {
          ...(nvExceptions.length > 0 ? { exceptions: nvExceptions } : {}),
        });
      } else {
        const joursApi: JourAlsh[] = nvJoursAlsh.map((j) => ({
          date: j.date,
          type: j.type,
          ...(j.repas ? { repas: j.repas } : {}),
        }));
        ecrire(contrat.id, mois, simule, {
          ...(joursApi.length > 0 ? { joursAlsh: joursApi } : {}),
        });
      }
    },
    [ecrire, contrat.id, mois, simule, mode],
  );

  // --- Ajustement cantine / périscolaire ------------------------------------

  const ouvrirAjustement = useCallback(
    (iso: string) => {
      if (mode === 'ALSH' || !estDansPeriode(iso)) return;
      const eff = effectif(iso);
      setPortee('mois');
      setDialogForm({ cantine: eff.cantine, matin: eff.matin, soir: eff.soir });
      setDialogDate(iso);
    },
    [mode, estDansPeriode, effectif],
  );

  /** Calcule l'exception à stocker pour une date (vide si conforme au template). */
  const exceptionPourDate = useCallback(
    (
      iso: string,
      choix: { cantine: boolean; matin: boolean; soir: boolean },
    ): ExceptionAbcm | null => {
      const t = inscriptionsTemplate(iso);
      const exc: ExceptionAbcm = { date: iso };
      let differe = false;
      if (mode === 'CANTINE') {
        if (choix.cantine !== (t.cantine ?? false)) {
          exc.cantine = choix.cantine;
          differe = true;
        }
      } else {
        if (choix.matin !== (t.periMatin ?? false)) {
          exc.periMatin = choix.matin;
          differe = true;
        }
        if (choix.soir !== (t.periSoir ?? false)) {
          exc.periSoir = choix.soir;
          differe = true;
        }
      }
      return differe ? exc : null;
    },
    [mode, inscriptionsTemplate],
  );

  const appliquerDurableAbcm = useCallback(
    (semaineModifiee: ContratLocal['semaineAbcm']) => {
      const corps: CreerContratAbcm = {
        mode,
        foyerId: contrat.foyerId,
        enfant: contrat.enfant,
        valideDu: contrat.valideDu,
        valideAu: contrat.valideAu,
        semaineAbcm: semaineModifiee ?? {},
      };
      setErreurDurable(null);
      api
        .modifierContrat(contrat.id, corps)
        .then(() => {
          setErreurDurable(null);
          setExceptions([]);
          setPai(undefined);
          setJoursAlsh([]);
          annoncer('Contrat modifié, saisies du mois réinitialisées');
          onContratModifie?.();
        })
        .catch((e: unknown) => {
          // Échec (429, réseau, validation…) : le contrat n'a PAS été modifié
          // (PUT atomique + court-circuit gateway). On signale l'erreur sans
          // toucher à l'état local — l'utilisateur peut réessayer.
          setErreurDurable(messageErreur(e));
        });
    },
    [mode, contrat, onContratModifie, annoncer],
  );

  const confirmerAjustement = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    const jourSemaine = jourSemaineDeIso(date);

    if (portee === 'tous') {
      const t = inscriptionsTemplate(date);
      const nouvelle = { ...semaineAbcm };
      nouvelle[jourSemaine] =
        mode === 'CANTINE'
          ? { ...t, cantine: dialogForm.cantine }
          : { ...t, periMatin: dialogForm.matin, periSoir: dialogForm.soir };
      setConfirmationDurable({
        semaineAbcm: nouvelle,
        message: `Appliquer ce changement à tous les ${jourSemaine.toLowerCase()}s modifie le contrat. Les saisies mensuelles existantes seront réinitialisées.`,
      });
      setDialogDate(null);
      return;
    }

    const exc = exceptionPourDate(date, dialogForm);
    const avaitException = exceptions.some((e) => e.date === date);
    const reste = exceptions.filter((e) => e.date !== date);
    const nouvelles = exc !== null ? [...reste, exc] : reste;
    setExceptions(nouvelles);
    setDialogDate(null);
    envoyer(joursAlsh, pai, nouvelles);
    if (exc !== null) {
      annoncer(`Jour ajusté le ${formaterDateFr(date)}`);
    } else if (avaitException) {
      annoncer(`Ajustement retiré le ${formaterDateFr(date)}`);
    }
  }, [
    dialogDate,
    dialogForm,
    portee,
    mode,
    semaineAbcm,
    inscriptionsTemplate,
    exceptionPourDate,
    exceptions,
    joursAlsh,
    pai,
    envoyer,
    annoncer,
  ]);

  const reinitialiserJour = useCallback(() => {
    if (dialogDate === null) return;
    const nouvelles = exceptions.filter((e) => e.date !== dialogDate);
    setExceptions(nouvelles);
    setDialogDate(null);
    envoyer(joursAlsh, pai, nouvelles);
    annoncer(`Ajustement retiré le ${formaterDateFr(dialogDate)}`);
  }, [dialogDate, exceptions, joursAlsh, pai, envoyer, annoncer]);

  // --- ALSH (inchangé) -------------------------------------------------------

  const ouvrirSaisieAlsh = useCallback(
    (iso: string) => {
      if (mode !== 'ALSH' || !iso.startsWith(mois)) return;
      const existing = joursAlsh.find((j) => j.date === iso);
      setPopoverForm(
        existing
          ? { type: existing.type, repas: existing.repas }
          : { type: 'COMPLETE', repas: false },
      );
      setPopoverDate(iso);
    },
    [mode, mois, joursAlsh],
  );

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      if (mode === 'ALSH') ouvrirSaisieAlsh(arg.dateStr);
      else ouvrirAjustement(arg.dateStr);
    },
    [mode, ouvrirSaisieAlsh, ouvrirAjustement],
  );

  const confirmerAlsh = useCallback(() => {
    if (popoverDate === null) return;
    const date = popoverDate;
    const existait = joursAlsh.some((j) => j.date === date);
    const nouveaux = joursAlsh.filter((j) => j.date !== date);
    nouveaux.push({ date, type: popoverForm.type, repas: popoverForm.repas });
    setJoursAlsh(nouveaux);
    setPopoverDate(null);
    envoyer(nouveaux, pai, exceptions);
    annoncer(
      `Journée ALSH ${existait ? 'modifiée' : 'ajoutée'} le ${formaterDateFr(date)}`,
    );
  }, [popoverDate, popoverForm, joursAlsh, pai, exceptions, envoyer, annoncer]);

  const supprimerAlsh = useCallback(() => {
    if (popoverDate === null) return;
    const date = popoverDate;
    const nouveaux = joursAlsh.filter((j) => j.date !== date);
    setJoursAlsh(nouveaux);
    setPopoverDate(null);
    envoyer(nouveaux, pai, exceptions);
    annoncer(`Journée ALSH retirée le ${formaterDateFr(date)}`);
  }, [popoverDate, joursAlsh, pai, exceptions, envoyer, annoncer]);

  const handlePaiChange = useCallback(
    (val: boolean) => {
      setPai(val);
      envoyer(joursAlsh, val, exceptions);
      annoncer(val ? 'PAI activé' : 'PAI désactivé');
    },
    [joursAlsh, exceptions, envoyer, annoncer],
  );

  const etatStatut = etat === 'enregistre' || etat === 'erreur' ? etat : 'idle';
  const initialDate = `${mois}-01`;
  const calKey = useRef(0);
  calKey.current = parseInt(mois.replace('-', ''), 10);

  const aExistant = (iso: string) => exceptions.some((e) => e.date === iso);

  return (
    <div>
      {/* AQ-05 : annonce des mutations du calendrier aux lecteurs d'écran. */}
      <p {...regionLiveProps} className="sr-only" />
      <div
        style={{
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        {mode === 'CANTINE' && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: 0,
              fontSize: '0.9rem',
            }}
          >
            <input
              type="checkbox"
              checked={pai ?? false}
              onChange={(e) => handlePaiChange(e.target.checked)}
              style={{ width: 'auto', padding: 0 }}
            />
            PAI (Projet d&apos;accueil individualisé)
          </label>
        )}

        {mode === 'ALSH' && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Cliquer sur un jour pour ajouter/modifier une journée ALSH, ou
            utiliser la liste ci-dessous au clavier.
          </span>
        )}

        <StatutSauvegarde etat={etatStatut} />
        {etat === 'erreur' && erreur && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {erreur}
          </span>
        )}
        {erreurDurable && (
          <span
            role="alert"
            className="muted"
            style={{ fontSize: '0.82rem', color: 'var(--erreur, #b00020)' }}
          >
            {erreurDurable}
          </span>
        )}
      </div>

      {mode !== 'ALSH' && (
        <>
          <LegendePlanning
            couleurGarde={couleur}
            libelleGarde={
              mode === 'CANTINE'
                ? 'Cantine (contrat)'
                : 'Périscolaire (contrat)'
            }
            ecartJours={ecartJours}
          />
          <div
            style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}
            className="muted"
          >
            Cliquer sur un jour pour ajouter ou retirer la prestation, ou
            utiliser la liste ci-dessous au clavier.
          </div>
        </>
      )}

      <FullCalendar
        key={calKey.current}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale="fr"
        initialDate={initialDate}
        headerToolbar={false}
        height="auto"
        events={events}
        dateClick={handleDateClick}
      />

      {/* Alternative clavier ALSH. */}
      {mode === 'ALSH' && joursDuMoisListe.length > 0 && (
        <fieldset style={{ marginTop: '1rem' }}>
          <legend>Saisir une journée ALSH (accessible au clavier)</legend>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {joursDuMoisListe.map((jour) => {
              const existant = joursAlsh.find((j) => j.date === jour);
              const libelleJour = formaterDateFr(jour);
              return (
                <li
                  key={jour}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.2rem 0',
                  }}
                >
                  <span style={{ minWidth: '8rem' }}>{libelleJour}</span>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {existant
                      ? existant.type === 'COMPLETE'
                        ? existant.repas
                          ? 'Journée + repas'
                          : 'Journée'
                        : 'Demi-journée'
                      : '—'}
                  </span>
                  <button
                    type="button"
                    className="btn secondaire"
                    onClick={() => ouvrirSaisieAlsh(jour)}
                    aria-label={
                      existant
                        ? `Modifier la journée ALSH du ${libelleJour}`
                        : `Saisir une journée ALSH le ${libelleJour}`
                    }
                  >
                    {existant ? 'Modifier' : 'Saisir'}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {/* Alternative clavier cantine / périscolaire. */}
      {mode !== 'ALSH' && joursDuMoisListe.length > 0 && (
        <fieldset style={{ marginTop: '1rem' }}>
          <legend>Ajuster un jour (accessible au clavier)</legend>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {joursDuMoisListe.map((jour) => {
              const eff = effectif(jour);
              const actif =
                mode === 'CANTINE' ? eff.cantine : eff.matin || eff.soir;
              const libelleJour = formaterDateFr(jour);
              return (
                <li
                  key={jour}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.2rem 0',
                  }}
                >
                  <span style={{ minWidth: '8rem' }}>{libelleJour}</span>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {actif ? 'Réservé' : '—'}
                  </span>
                  <button
                    type="button"
                    className="btn secondaire"
                    onClick={() => ouvrirAjustement(jour)}
                    aria-label={`Ajuster le ${libelleJour} (${
                      actif ? 'réservé' : 'non réservé'
                    })`}
                  >
                    Ajuster
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {/* Modale ajustement cantine / périscolaire. */}
      {dialogDate !== null && (
        <Modale
          titre={`Ajuster le ${formaterDateFr(dialogDate)}`}
          onClose={() => setDialogDate(null)}
        >
          {mode === 'CANTINE' ? (
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
                checked={dialogForm.cantine}
                onChange={(e) =>
                  setDialogForm((f) => ({ ...f, cantine: e.target.checked }))
                }
                style={{ width: 'auto', padding: 0 }}
              />
              Cantine
            </label>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
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
                  checked={dialogForm.matin}
                  onChange={(e) =>
                    setDialogForm((f) => ({ ...f, matin: e.target.checked }))
                  }
                  style={{ width: 'auto', padding: 0 }}
                />
                Matin
              </label>
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
                  checked={dialogForm.soir}
                  onChange={(e) =>
                    setDialogForm((f) => ({ ...f, soir: e.target.checked }))
                  }
                  style={{ width: 'auto', padding: 0 }}
                />
                Soir
              </label>
            </div>
          )}

          <ChoixPortee valeur={portee} onChange={setPortee} nom="abcm" />

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn" onClick={confirmerAjustement}>
              Confirmer
            </button>
            {portee === 'mois' && aExistant(dialogDate) && (
              <button
                type="button"
                className="btn secondaire"
                onClick={reinitialiserJour}
              >
                Réinitialiser
              </button>
            )}
            <button
              type="button"
              className="btn secondaire"
              onClick={() => setDialogDate(null)}
            >
              Annuler
            </button>
          </div>
        </Modale>
      )}

      {/* Modale ALSH. */}
      {popoverDate !== null && (
        <Modale
          titre={`Journée ALSH du ${formaterDateFr(popoverDate)}`}
          onClose={() => setPopoverDate(null)}
        >
          <label>
            Type
            <select
              value={popoverForm.type}
              onChange={(e) =>
                setPopoverForm((f) => ({
                  ...f,
                  type: e.target.value as 'COMPLETE' | 'DEMI',
                }))
              }
            >
              <option value="COMPLETE">Journée complète</option>
              <option value="DEMI">Demi-journée</option>
            </select>
          </label>

          <label
            style={{
              flexDirection: 'row',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              marginTop: '0.5rem',
            }}
          >
            <input
              type="checkbox"
              checked={popoverForm.repas}
              onChange={(e) =>
                setPopoverForm((f) => ({ ...f, repas: e.target.checked }))
              }
              style={{ width: 'auto', padding: 0 }}
            />
            Repas inclus
          </label>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn" onClick={confirmerAlsh}>
              Confirmer
            </button>
            {joursAlsh.some((j) => j.date === popoverDate) && (
              <button
                type="button"
                className="btn secondaire"
                onClick={supprimerAlsh}
              >
                Supprimer
              </button>
            )}
            <button
              type="button"
              className="btn secondaire"
              onClick={() => setPopoverDate(null)}
            >
              Annuler
            </button>
          </div>
        </Modale>
      )}

      {/* Confirmation d'une modification durable du contrat. */}
      <ModaleConfirmation
        ouvert={confirmationDurable !== null}
        titre="Modifier le contrat ?"
        message={confirmationDurable?.message ?? ''}
        libelleConfirmer="Modifier le contrat"
        destructif
        onConfirmer={() => {
          if (confirmationDurable) {
            appliquerDurableAbcm(confirmationDurable.semaineAbcm);
          }
          setConfirmationDurable(null);
        }}
        onAnnuler={() => setConfirmationDurable(null)}
      />
    </div>
  );
}

/** Fabrique un événement FullCalendar « pleine journée ». */
function evt(date: string, couleur: string, titre: string): EventInput {
  return {
    id: `${titre}-${date}`,
    start: date,
    allDay: true,
    backgroundColor: couleur,
    borderColor: couleur,
    title: titre,
  };
}
