import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventInput } from '@fullcalendar/core';
import type {
  ContratLocal,
  JourAlsh,
  ExceptionAbcm,
  CreerContratAbcm,
  LienEtablissementSaisie,
  InscriptionsJour,
} from '../types/bff';
import { joursDuMois, jourSemaineDeIso, formaterDateFr } from '../utils/dates';
import { alshEffectif } from '../notifications/besoinsSemaine';
import { couleurDuMode } from '../utils/couleurs';
import { Modale } from '../ui/Modale';
import { LegendePlanning } from './LegendePlanning';
import { ChoixPortee } from './ChoixPortee';
import { couleurAjoute, couleurRetire } from './couleursPlanning';
import { BarreStatutCalendrier } from './BarreStatutCalendrier';
import { CalendrierMois } from './CalendrierMois';
import { ModaleContratDurable } from './ModaleContratDurable';
import {
  socleContratDurable,
  useCalendrierContrat,
} from './useCalendrierContrat';

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
  const mode = contrat.mode as 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';

  const [pai, setPai] = useState<boolean | undefined>(undefined);
  const [joursAlsh, setJoursAlsh] = useState<EtatAlsh[]>([]);
  // Ajustements ponctuels par date (CANTINE / PERISCOLAIRE).
  const [exceptions, setExceptions] = useState<ExceptionAbcm[]>([]);

  // Remplacement complet du contrat (PUT) pour la portée « tous les X » : la
  // semaine ABCM modifiée est le payload, le reste du contrat est reconduit.
  const construireCorpsDurable = useCallback(
    (
      semaineModifiee: ContratLocal['semaineAbcm'],
    ): CreerContratAbcm & LienEtablissementSaisie => ({
      mode,
      semaineAbcm: semaineModifiee ?? {},
      ...socleContratDurable(contrat),
    }),
    [mode, contrat],
  );

  const reinitialiserSaisie = useCallback(() => {
    setExceptions([]);
    setPai(undefined);
    setJoursAlsh([]);
  }, []);

  // Enveloppe commune : écriture debouncée + statut, réhydratation serveur,
  // annonces (AQ-05), portée et flux de modification durable du contrat.
  const {
    ecrire,
    erreur,
    etat,
    enregistreA,
    reessayer,
    saisieServeur,
    chargee,
    marquerSaisieLocale,
    saisieServeurObsolete,
    annoncer,
    regionLiveProps,
    estDansPeriode,
    portee,
    setPortee,
    confirmationDurable,
    demanderConfirmationDurable,
    confirmerDurable,
    annulerDurable,
    erreurDurable,
    succesDurable,
  } = useCalendrierContrat<ContratLocal['semaineAbcm']>({
    contrat,
    mois,
    simule,
    onEnregistre,
    onContratModifie,
    construireCorpsDurable,
    reinitialiserSaisie,
  });

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
    // Anti-clobber : une édition locale survenue PENDANT le chargement rend ce
    // GET périmé — on l'ignore pour ne pas écraser la saisie récente du parent.
    if (saisieServeurObsolete()) return;
    setPai(saisieServeur.pai);
    setExceptions(saisieServeur.exceptions ?? []);
    setJoursAlsh(
      (saisieServeur.joursAlsh ?? []).map((j) => ({
        date: j.date,
        type: j.type,
        repas: j.repas ?? false,
      })),
    );
  }, [chargee, saisieServeur, saisieServeurObsolete]);

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

  // Mémorisé : la valeur par défaut `{}` créerait sinon une nouvelle référence à
  // chaque rendu et invaliderait les hooks qui en dépendent.
  const semaineAbcm = useMemo(
    () => contrat.semaineAbcm ?? {},
    [contrat.semaineAbcm],
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

  // Jour explicite (state ALSH) d'une date, converti à la forme récurrente.
  const alshExplicite = useCallback(
    (iso: string) => {
      const j = joursAlsh.find((x) => x.date === iso);
      return j ? { type: j.type, repas: j.repas } : undefined;
    },
    [joursAlsh],
  );

  // Jour ALSH EFFECTIF d'une date (explicite > exception > récurrence), `null`
  // si non réservé — même sémantique que `dashboard/jourFoyer.ts`.
  const alshEffectifDe = useCallback(
    (iso: string) =>
      alshEffectif(iso, alshExplicite(iso), exceptionDe(iso), semaineAbcm),
    [alshExplicite, exceptionDe, semaineAbcm],
  );

  // Récurrence hebdomadaire brute de ce jour de semaine (sans exception ni explicite).
  const alshRecurrent = useCallback(
    (iso: string) => inscriptionsTemplate(iso).alsh,
    [inscriptionsTemplate],
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

  // Écart net ALSH vs contrat (jours réservés ajoutés − jours récurrents retirés).
  const ecartJoursAlsh = useMemo(() => {
    if (mode !== 'ALSH') return 0;
    let ajoutes = 0;
    let retires = 0;
    for (const iso of joursDuMois(mois)) {
      if (!estDansPeriode(iso)) continue;
      const recurrent = alshRecurrent(iso) !== undefined;
      const effActif = alshEffectifDe(iso) !== null;
      if (effActif && !recurrent) ajoutes += 1;
      if (!effActif && recurrent) retires += 1;
    }
    return ajoutes - retires;
  }, [mode, mois, estDansPeriode, alshRecurrent, alshEffectifDe]);

  const events = useMemo<EventInput[]>(() => {
    if (mode === 'ALSH') {
      const evts: EventInput[] = [];
      for (const iso of joursDuMois(mois)) {
        if (!estDansPeriode(iso)) continue;
        const eff = alshEffectifDe(iso);
        const recurrent = alshRecurrent(iso);
        const explicite = alshExplicite(iso);
        if (eff) {
          // Réservé effectivement : ajout ponctuel hors récurrence → vert,
          // sinon couleur du mode (récurrence, éventuellement ajustée explicitement).
          const ajoute = !recurrent && explicite !== undefined;
          const titre =
            eff.type === 'COMPLETE'
              ? eff.repas
                ? 'Journée + repas'
                : 'Journée'
              : 'Demi-journée';
          evts.push(evt(iso, ajoute ? couleurAjout : couleur, titre));
        } else if (recurrent) {
          // Jour récurrent retiré ponctuellement (exception `alsh:false`) → rouge.
          evts.push(evt(iso, couleurRet, 'Retiré'));
        }
      }
      return evts;
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
    mois,
    joursPeriode,
    estDansPeriode,
    alshEffectifDe,
    alshRecurrent,
    alshExplicite,
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
      // Toute édition locale passe par ici : on marque la divergence pour qu'un
      // GET de réhydratation encore en vol ne vienne pas l'écraser à son retour.
      marquerSaisieLocale();
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
        // Les exceptions ALSH (`alsh:false`/`true`) portent les retraits/ajouts
        // ponctuels de la récurrence hebdomadaire → elles doivent partir aussi.
        ecrire(contrat.id, mois, simule, {
          ...(joursApi.length > 0 ? { joursAlsh: joursApi } : {}),
          ...(nvExceptions.length > 0 ? { exceptions: nvExceptions } : {}),
        });
      }
    },
    [ecrire, contrat.id, mois, simule, mode, marquerSaisieLocale],
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
      // Message en conséquences concrètes : ce que devient ce jour de semaine,
      // chaque semaine (le rappel des effets communs vit dans la modale).
      const nouvelEtat =
        mode === 'CANTINE'
          ? dialogForm.cantine
            ? 'la cantine sera réservée'
            : 'la cantine ne sera plus réservée'
          : dialogForm.matin && dialogForm.soir
            ? 'l’accueil périscolaire du matin et du soir sera réservé'
            : dialogForm.matin
              ? 'seul l’accueil périscolaire du matin sera réservé'
              : dialogForm.soir
                ? 'seul l’accueil périscolaire du soir sera réservé'
                : 'l’accueil périscolaire ne sera plus réservé';
      demanderConfirmationDurable(
        nouvelle,
        `Tous les ${jourSemaine.toLowerCase()}s, ${nouvelEtat}.`,
      );
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
    demanderConfirmationDurable,
  ]);

  const reinitialiserJour = useCallback(() => {
    if (dialogDate === null) return;
    const nouvelles = exceptions.filter((e) => e.date !== dialogDate);
    setExceptions(nouvelles);
    setDialogDate(null);
    envoyer(joursAlsh, pai, nouvelles);
    annoncer(`Ajustement retiré le ${formaterDateFr(dialogDate)}`);
  }, [dialogDate, exceptions, joursAlsh, pai, envoyer, annoncer]);

  // --- ALSH -----------------------------------------------------------------

  const ouvrirSaisieAlsh = useCallback(
    (iso: string) => {
      if (mode !== 'ALSH' || !iso.startsWith(mois) || !estDansPeriode(iso))
        return;
      // Prérempli depuis l'état EFFECTIF (explicite > exception > récurrence).
      const eff = alshEffectifDe(iso);
      setPortee('mois');
      setPopoverForm(
        eff
          ? { type: eff.type, repas: eff.repas ?? false }
          : { type: 'COMPLETE', repas: false },
      );
      setPopoverDate(iso);
    },
    [mode, mois, estDansPeriode, alshEffectifDe, setPortee],
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
    const jourSemaine = jourSemaineDeIso(date);

    // Portée durable : la formule devient la récurrence hebdomadaire du contrat.
    if (portee === 'tous') {
      const t = inscriptionsTemplate(date);
      const nouvelle = { ...semaineAbcm };
      nouvelle[jourSemaine] = {
        ...t,
        alsh: {
          type: popoverForm.type,
          ...(popoverForm.repas ? { repas: true } : {}),
        },
      };
      const detail =
        popoverForm.type === 'DEMI'
          ? 'une demi-journée sera réservée'
          : popoverForm.repas
            ? 'une journée avec repas sera réservée'
            : 'une journée sera réservée';
      demanderConfirmationDurable(
        nouvelle,
        `Tous les ${jourSemaine.toLowerCase()}s, ${detail}.`,
      );
      setPopoverDate(null);
      return;
    }

    // Ponctuel : un jour explicite prime et lève une éventuelle exception `alsh:false`.
    const existait = alshEffectifDe(date) !== null;
    const nouveaux = joursAlsh.filter((j) => j.date !== date);
    nouveaux.push({ date, type: popoverForm.type, repas: popoverForm.repas });
    const nvExceptions = exceptions.filter((e) => e.date !== date);
    setJoursAlsh(nouveaux);
    setExceptions(nvExceptions);
    setPopoverDate(null);
    envoyer(nouveaux, pai, nvExceptions);
    annoncer(
      `Journée ALSH ${existait ? 'modifiée' : 'ajoutée'} le ${formaterDateFr(date)}`,
    );
  }, [
    popoverDate,
    popoverForm,
    portee,
    semaineAbcm,
    inscriptionsTemplate,
    demanderConfirmationDurable,
    alshEffectifDe,
    joursAlsh,
    exceptions,
    pai,
    envoyer,
    annoncer,
  ]);

  const supprimerAlsh = useCallback(() => {
    if (popoverDate === null) return;
    const date = popoverDate;
    // Retire le jour effectif : lève le jour explicite, puis neutralise la
    // récurrence hebdomadaire par une exception `alsh:false` si elle réserverait
    // encore ce jour ; sinon nettoie l'exception résiduelle.
    const nouveaux = joursAlsh.filter((j) => j.date !== date);
    const reste = exceptions.filter((e) => e.date !== date);
    const nvExceptions = alshRecurrent(date)
      ? [...reste, { date, alsh: false }]
      : reste;
    setJoursAlsh(nouveaux);
    setExceptions(nvExceptions);
    setPopoverDate(null);
    envoyer(nouveaux, pai, nvExceptions);
    annoncer(`Journée ALSH retirée le ${formaterDateFr(date)}`);
  }, [
    popoverDate,
    joursAlsh,
    exceptions,
    alshRecurrent,
    pai,
    envoyer,
    annoncer,
  ]);

  const handlePaiChange = useCallback(
    (val: boolean) => {
      setPai(val);
      envoyer(joursAlsh, val, exceptions);
      annoncer(val ? 'PAI activé' : 'PAI désactivé');
    },
    [joursAlsh, exceptions, envoyer, annoncer],
  );

  const aExistant = (iso: string) => exceptions.some((e) => e.date === iso);

  return (
    <div>
      {/* AQ-05 : annonce des mutations du calendrier aux lecteurs d'écran. */}
      <p {...regionLiveProps} className="sr-only" />
      <BarreStatutCalendrier
        etat={etat}
        enregistreA={enregistreA}
        erreur={erreur}
        onReessayer={reessayer}
        erreurDurable={erreurDurable}
        succesDurable={succesDurable}
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
              onChange={(e) => {
                handlePaiChange(e.target.checked);
              }}
              style={{ width: 'auto', padding: 0 }}
            />
            PAI (Projet d&apos;accueil individualisé)
          </label>
        )}

        {mode === 'ALSH' && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Cliquer sur un jour pour ajouter, modifier ou retirer une journée
            ALSH, ou utiliser la liste ci-dessous au clavier.
          </span>
        )}
      </BarreStatutCalendrier>

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

      {mode === 'ALSH' && (
        <LegendePlanning
          couleurGarde={couleur}
          libelleGarde="ALSH (contrat)"
          ecartJours={ecartJoursAlsh}
        />
      )}

      <CalendrierMois
        mois={mois}
        events={events}
        onDateClick={handleDateClick}
      />

      {/* Alternative clavier ALSH. */}
      {mode === 'ALSH' && joursDuMoisListe.length > 0 && (
        <fieldset style={{ marginTop: '1rem' }}>
          <legend>Saisir une journée ALSH (accessible au clavier)</legend>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {joursDuMoisListe.map((jour) => {
              const eff = alshEffectifDe(jour);
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
                    {eff
                      ? eff.type === 'COMPLETE'
                        ? eff.repas
                          ? 'Journée + repas'
                          : 'Journée'
                        : 'Demi-journée'
                      : '—'}
                  </span>
                  <button
                    type="button"
                    className="btn secondaire"
                    onClick={() => {
                      ouvrirSaisieAlsh(jour);
                    }}
                    aria-label={
                      eff
                        ? `Modifier la journée ALSH du ${libelleJour}`
                        : `Saisir une journée ALSH le ${libelleJour}`
                    }
                  >
                    {eff ? 'Modifier' : 'Saisir'}
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
                    onClick={() => {
                      ouvrirAjustement(jour);
                    }}
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
          onClose={() => {
            setDialogDate(null);
          }}
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
                onChange={(e) => {
                  setDialogForm((f) => ({ ...f, cantine: e.target.checked }));
                }}
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
                  onChange={(e) => {
                    setDialogForm((f) => ({ ...f, matin: e.target.checked }));
                  }}
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
                  onChange={(e) => {
                    setDialogForm((f) => ({ ...f, soir: e.target.checked }));
                  }}
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
              onClick={() => {
                setDialogDate(null);
              }}
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
          onClose={() => {
            setPopoverDate(null);
          }}
        >
          <label>
            Type
            <select
              value={popoverForm.type}
              onChange={(e) => {
                setPopoverForm((f) => ({
                  ...f,
                  type: e.target.value as 'COMPLETE' | 'DEMI',
                }));
              }}
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
              onChange={(e) => {
                setPopoverForm((f) => ({ ...f, repas: e.target.checked }));
              }}
              style={{ width: 'auto', padding: 0 }}
            />
            Repas inclus
          </label>

          <ChoixPortee valeur={portee} onChange={setPortee} nom="alsh" />

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn" onClick={confirmerAlsh}>
              Confirmer
            </button>
            {portee === 'mois' && alshEffectifDe(popoverDate) !== null && (
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
              onClick={() => {
                setPopoverDate(null);
              }}
            >
              Annuler
            </button>
          </div>
        </Modale>
      )}

      {/* Confirmation d'une modification durable du contrat. */}
      <ModaleContratDurable
        confirmation={confirmationDurable}
        onConfirmer={confirmerDurable}
        onAnnuler={annulerDurable}
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
