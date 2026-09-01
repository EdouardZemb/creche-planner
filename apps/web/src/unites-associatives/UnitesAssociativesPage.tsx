import { useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type {
  CompteursUaVue,
  CoutProjeteUaVue,
  SessionUaVue,
  SuiviUaVue,
} from '../types/bff';
import { centimesEnEuros } from '../utils/money';
import { messageErreur } from '../utils/erreurs';
import { useAsync } from '../hooks/useAsync';
import { useTitrePage } from '../hooks/useTitrePage';
import { ChargementPage } from '../ui/ChargementPage';
import { EtatVide } from '../ui/EtatVide';
import { Badge } from '../ui/Badge';
import { Bouton } from '../ui/Bouton';
import { ChampFormulaire } from '../ui/ChampFormulaire';

/**
 * Écran de **suivi** des unités associatives (SFD 40, US-40-04).
 *
 * Il répond à une seule question : « combien me reste-t-il à faire, et jusqu'à
 * quand ? ». Trois choses le gouvernent, et aucune n'est cosmétique :
 *
 * 1. **Les trois compteurs sont montrés séparément**, avec leur définition en
 *    clair. Les confondre est la première erreur d'écran possible (SFD 40 §3.1) :
 *    un créneau réservé n'a rien acquitté.
 * 2. **Un coût projeté ne s'affiche jamais sans son hypothèse** (`RM-40-05`).
 *    Le nombre seul mentirait par omission.
 * 3. **L'écran dit que Martha n'a rien réservé** (`RM-40-01`). La réservation
 *    reste celle du site travaux de l'association ; ici on tient le compte.
 */

/**
 * Valeurs **proposées** au premier écran (doc 02 §4.5, RI annexe 2) : 20 UA,
 * 31,25 € l'unité, caution 625 €, période 1er juin → 31 mai. Ce sont des
 * propositions modifiables, jamais des constantes de calcul (`RM-40-02`) — le
 * service, lui, n'a aucun défaut et exige la saisie.
 *
 * ⚠️ Non revérifiées pour 2026/27 (`Q-40-01`) : ce sont trois nombres à
 * confirmer auprès de l'association, pas un modèle à trouver.
 */
const PROPOSITION = {
  quotaHeures: 20,
  valeurUaCentimes: 3125,
  cautionCentimes: 62500,
};

/** Types de créneau, alignés sur le catalogue du domaine (`TYPES_SESSION_UA`). */
const TYPES: readonly { code: string; libelle: string }[] = [
  { code: 'MENAGE', libelle: 'Ménage régulier' },
  { code: 'CANTINE', libelle: 'Service cantine' },
  { code: 'GRAND_MENAGE', libelle: 'Grand ménage ponctuel' },
  { code: 'CVE', libelle: 'Comité des événements (CVE)' },
  { code: 'TALENT', libelle: 'Savoir-faire (peinture, plomberie…)' },
  { code: 'AUTRE', libelle: 'Autre' },
];

const LIBELLE_TYPE = new Map(TYPES.map((t) => [t.code, t.libelle]));

/** Bornes de la période proposée, calées sur le 1er juin de l'année en cours. */
function periodeProposee(aujourdhui: string): { debut: string; fin: string } {
  const annee = Number(aujourdhui.slice(0, 4));
  const avantJuin = aujourdhui.slice(5) < '06-01';
  const debut = avantJuin ? annee - 1 : annee;
  return {
    debut: `${String(debut)}-06-01`,
    fin: `${String(debut + 1)}-05-31`,
  };
}

/** « 20 h », « 2 h 30 » — les demi-heures existent, les décimales nues non. */
export function formaterHeures(heures: number): string {
  const entier = Math.floor(heures);
  const minutes = Math.round((heures - entier) * 60);
  return minutes === 0
    ? `${String(entier)} h`
    : `${String(entier)} h ${String(minutes).padStart(2, '0')}`;
}

/** Phrase d'échéance, jamais un nombre nu : « dans 42 jours », « dépassée ». */
export function phraseEcheance(jours: number, fin: string): string {
  const date = new Date(`${fin}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (jours < 0) {
    return `Échéance dépassée depuis le ${date}`;
  }
  if (jours === 0) {
    return `Échéance aujourd’hui, le ${date}`;
  }
  return `Échéance le ${date}, dans ${String(jours)} jour${jours > 1 ? 's' : ''}`;
}

/** Un compteur, avec sa définition — c'est elle qui empêche de les confondre. */
function Compteur({
  titre,
  valeur,
  definition,
}: {
  titre: string;
  valeur: number;
  definition: string;
}) {
  return (
    <div className="carte">
      <h3>{titre}</h3>
      <p>
        <strong>{formaterHeures(valeur)}</strong>
      </p>
      <p className="muted">{definition}</p>
    </div>
  );
}

/** Un coût projeté avec son hypothèse en toutes lettres (`RM-40-05`). */
function CoutProjete({
  cout,
  hypothese,
}: {
  cout: CoutProjeteUaVue;
  hypothese: string;
}) {
  return (
    <div className="carte">
      <h3>{centimesEnEuros(cout.montantCentimes)}</h3>
      <p className="muted">{hypothese}</p>
    </div>
  );
}

function Compteurs({
  compteurs,
  fin,
}: {
  compteurs: CompteursUaVue;
  fin: string;
}) {
  return (
    <>
      <p>
        Quota de la période :{' '}
        <strong>{formaterHeures(compteurs.quotaHeures)}</strong> d’unités
        associatives.
      </p>
      <p data-testid="echeance-ua">
        {phraseEcheance(compteurs.joursAvantEcheance, fin)}
      </p>
      {compteurs.alerteEcheance && (
        <p role="status" data-testid="alerte-ua">
          <Badge variante="erreur">
            Il reste {formaterHeures(compteurs.heuresRestantes)} à faire avant
            l’échéance
          </Badge>
        </p>
      )}
      <div className="cartes-compteurs-ua">
        <Compteur
          titre="Réalisé"
          valeur={compteurs.heuresRealisees}
          definition="Ce qui est acquis. Seul compteur qui solde l’obligation."
        />
        <Compteur
          titre="Réservé"
          valeur={compteurs.heuresReservees}
          definition="Engagé mais pas encore fait — un créneau annulé le fait retomber."
        />
        <Compteur
          titre="Restant"
          valeur={compteurs.heuresRestantes}
          definition="Ce qu’il reste à aller chercher sur le site travaux."
        />
      </div>
      {compteurs.heuresAConfirmer > 0 && (
        <p className="muted" data-testid="a-confirmer-ua">
          {formaterHeures(compteurs.heuresAConfirmer)} de créneaux passés sont
          encore « prévus » : à confirmer. Martha ne les compte pas d’office
          comme réalisés.
        </p>
      )}
      {compteurs.quotaAtteint ? (
        <p data-testid="quota-atteint-ua">
          <Badge variante="succes">Quota atteint : caution rendue, 0 €</Badge>
        </p>
      ) : (
        <div className="cartes-compteurs-ua">
          <CoutProjete
            cout={compteurs.coutSiArret}
            hypothese="si tu t’arrêtes là"
          />
          <CoutProjete
            cout={compteurs.coutSiReservationsRealisees}
            hypothese="si tu réalises tes créneaux déjà réservés"
          />
        </div>
      )}
    </>
  );
}

/** Liste des créneaux notés, avec les deux gestes qui font bouger un compteur. */
function Sessions({
  sessions,
  surChangerEtat,
  enCours,
}: {
  sessions: readonly SessionUaVue[];
  surChangerEtat: (id: string, etat: 'REALISEE' | 'ANNULEE') => void;
  enCours: string | null;
}) {
  if (sessions.length === 0) {
    return (
      <p className="muted">
        Aucun créneau noté pour cette période. Les créneaux se réservent sur le
        site travaux de l’association ; notez-les ici pour suivre votre reste à
        faire.
      </p>
    );
  }
  return (
    <ul className="liste-sessions-ua">
      {sessions.map((session) => (
        <li key={session.id}>
          <span>
            {new Date(`${session.date}T00:00:00Z`).toLocaleDateString('fr-FR', {
              timeZone: 'UTC',
            })}{' '}
            — {LIBELLE_TYPE.get(session.type) ?? session.type} —{' '}
            {formaterHeures(session.dureeHeures)}
            {session.realisePar !== null && ` — ${session.realisePar}`}
          </span>{' '}
          {session.etat === 'REALISEE' && <Badge variante="succes">Fait</Badge>}
          {session.etat === 'ANNULEE' && <Badge>Annulé</Badge>}
          {session.etat === 'PREVUE' && session.aConfirmer && (
            <Badge variante="simulation">À confirmer</Badge>
          )}
          {session.etat === 'PREVUE' && !session.aConfirmer && (
            <Badge>Prévu</Badge>
          )}
          {session.etat === 'PREVUE' && (
            <>
              <Bouton
                variante="secondaire"
                disabled={enCours === session.id}
                onClick={() => {
                  surChangerEtat(session.id, 'REALISEE');
                }}
              >
                C’est fait
              </Bouton>
              <Bouton
                variante="danger-contour"
                disabled={enCours === session.id}
                onClick={() => {
                  surChangerEtat(session.id, 'ANNULEE');
                }}
              >
                Annulé
              </Bouton>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Saisie d'un créneau en quatre champs (US-40-02 CA1). */
function FormulaireSession({
  engagementId,
  bornes,
  surAjout,
}: {
  engagementId: string;
  bornes: { debut: string; fin: string };
  surAjout: (saisie: {
    engagementId: string;
    date: string;
    dureeHeures: number;
    type: string;
    realisePar?: string;
  }) => Promise<void>;
}) {
  const prefixe = useId();
  const [date, setDate] = useState('');
  const [duree, setDuree] = useState('2');
  const [type, setType] = useState('MENAGE');
  const [qui, setQui] = useState('');
  const [envoi, setEnvoi] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setEnvoi(true);
        void surAjout({
          engagementId,
          date,
          dureeHeures: Number(duree),
          type,
          ...(qui !== '' ? { realisePar: qui } : {}),
        }).finally(() => {
          setEnvoi(false);
          setDate('');
          setQui('');
        });
      }}
    >
      <ChampFormulaire id={`${prefixe}-date`} libelle="Date du créneau" requis>
        {(controle) => (
          <input
            {...controle}
            type="date"
            required
            min={bornes.debut}
            max={bornes.fin}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <ChampFormulaire id={`${prefixe}-duree`} libelle="Durée (heures)" requis>
        {(controle) => (
          <input
            {...controle}
            type="number"
            required
            min="0.25"
            max="24"
            step="0.25"
            value={duree}
            onChange={(e) => {
              setDuree(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <ChampFormulaire id={`${prefixe}-type`} libelle="Type de créneau" requis>
        {(controle) => (
          <select
            {...controle}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
            }}
          >
            {TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.libelle}
              </option>
            ))}
          </select>
        )}
      </ChampFormulaire>
      <ChampFormulaire
        id={`${prefixe}-qui`}
        libelle="Qui s’y colle (facultatif)"
      >
        {(controle) => (
          <input
            {...controle}
            type="text"
            value={qui}
            onChange={(e) => {
              setQui(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <Bouton type="submit" disabled={envoi}>
        Noter ce créneau
      </Bouton>
    </form>
  );
}

/** Déclaration de la période, pré-remplie des valeurs du RI — modifiables. */
function FormulaireEngagement({
  aujourdhui,
  surDeclaration,
}: {
  aujourdhui: string;
  surDeclaration: (saisie: {
    debut: string;
    fin: string;
    quotaHeures: number;
    valeurUaCentimes: number;
    cautionCentimes: number;
  }) => Promise<void>;
}) {
  const prefixe = useId();
  const proposee = periodeProposee(aujourdhui);
  const [debut, setDebut] = useState(proposee.debut);
  const [fin, setFin] = useState(proposee.fin);
  const [quota, setQuota] = useState(String(PROPOSITION.quotaHeures));
  const [valeur, setValeur] = useState(
    String(PROPOSITION.valeurUaCentimes / 100),
  );
  const [caution, setCaution] = useState(
    String(PROPOSITION.cautionCentimes / 100),
  );
  const [envoi, setEnvoi] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setEnvoi(true);
        void surDeclaration({
          debut,
          fin,
          quotaHeures: Number(quota),
          valeurUaCentimes: Math.round(Number(valeur) * 100),
          cautionCentimes: Math.round(Number(caution) * 100),
        }).finally(() => {
          setEnvoi(false);
        });
      }}
    >
      <p className="muted">
        Les valeurs ci-dessous sont celles du règlement intérieur de
        l’association (annexe 2). Elles sont <strong>proposées</strong>, pas
        imposées : corrigez-les si votre situation diffère.
      </p>
      <ChampFormulaire
        id={`${prefixe}-debut`}
        libelle="Début de période"
        requis
      >
        {(controle) => (
          <input
            {...controle}
            type="date"
            required
            value={debut}
            onChange={(e) => {
              setDebut(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <ChampFormulaire id={`${prefixe}-fin`} libelle="Fin de période" requis>
        {(controle) => (
          <input
            {...controle}
            type="date"
            required
            value={fin}
            onChange={(e) => {
              setFin(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <ChampFormulaire
        id={`${prefixe}-quota`}
        libelle="Quota d’unités associatives (heures)"
        requis
      >
        {(controle) => (
          <input
            {...controle}
            type="number"
            required
            min="0"
            step="0.5"
            value={quota}
            onChange={(e) => {
              setQuota(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <ChampFormulaire
        id={`${prefixe}-valeur`}
        libelle="Valeur d’une unité non réalisée (€)"
        requis
      >
        {(controle) => (
          <input
            {...controle}
            type="number"
            required
            min="0"
            step="0.01"
            value={valeur}
            onChange={(e) => {
              setValeur(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <ChampFormulaire id={`${prefixe}-caution`} libelle="Caution déposée (€)">
        {(controle) => (
          <input
            {...controle}
            type="number"
            min="0"
            step="0.01"
            value={caution}
            onChange={(e) => {
              setCaution(e.target.value);
            }}
          />
        )}
      </ChampFormulaire>
      <Bouton type="submit" disabled={envoi}>
        Déclarer cette période
      </Bouton>
    </form>
  );
}

export function UnitesAssociativesPage() {
  const { foyerId } = useParams<{ foyerId: string }>();
  const id = foyerId ?? '';
  useTitrePage('Unités associatives');

  const etat = useAsync<SuiviUaVue>(
    (signal) => api.lireSuiviUnitesAssociatives(id, { signal }),
    [id],
  );
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [sessionEnCours, setSessionEnCours] = useState<string | null>(null);

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setErreurAction(null);
    try {
      await action();
      etat.reload();
    } catch (erreur) {
      setErreurAction(messageErreur(erreur));
    }
  };

  if (etat.loading && etat.data === null) {
    return (
      <ChargementPage message="Chargement du suivi des unités associatives…" />
    );
  }
  if (etat.error !== null && etat.data === null) {
    return (
      <EtatVide
        titrePrincipal
        titre="Suivi indisponible"
        description={etat.error}
        actions={[
          {
            libelle: 'Réessayer',
            onClick: () => {
              etat.reload();
            },
          },
        ]}
      />
    );
  }
  const suivi = etat.data;
  if (suivi === null) {
    return null;
  }

  return (
    <div id="unites-associatives">
      <h1>Unités associatives</h1>
      {/* RM-40-01 — la frontière, écrite à l'écran et pas seulement en doc. */}
      <p className="muted" data-testid="frontiere-site-travaux">
        Martha ne réserve aucun créneau. Les créneaux se prennent sur le site
        travaux de l’association ; cet écran tient le compte de ce que vous y
        avez réservé et de ce que vous avez fait.
      </p>

      {erreurAction !== null && (
        <p role="alert" data-testid="erreur-ua">
          {erreurAction}
        </p>
      )}

      {suivi.engagement === null || suivi.compteurs === null ? (
        <section>
          <h2>Déclarer la période</h2>
          <p className="muted">
            Aucune période d’unités associatives n’est déclarée pour votre
            famille. Déclarez-la pour voir votre reste à faire.
          </p>
          <FormulaireEngagement
            aujourdhui={suivi.aujourdhui}
            surDeclaration={(saisie) =>
              agir(() => api.declarerEngagementUa(id, saisie))
            }
          />
        </section>
      ) : (
        <>
          <section>
            <h2>Où j’en suis</h2>
            <Compteurs compteurs={suivi.compteurs} fin={suivi.engagement.fin} />
          </section>
          <section>
            <h2>Mes créneaux</h2>
            <Sessions
              sessions={suivi.sessions}
              enCours={sessionEnCours}
              surChangerEtat={(sessionId, nouvelEtat) => {
                setSessionEnCours(sessionId);
                void agir(() =>
                  api.modifierSessionUa(id, sessionId, { etat: nouvelEtat }),
                ).finally(() => {
                  setSessionEnCours(null);
                });
              }}
            />
          </section>
          <section>
            <h2>Noter un créneau réservé</h2>
            <FormulaireSession
              engagementId={suivi.engagement.id}
              bornes={{
                debut: suivi.engagement.debut,
                fin: suivi.engagement.fin,
              }}
              surAjout={(saisie) =>
                agir(() => api.ajouterSessionUa(id, saisie))
              }
            />
          </section>
        </>
      )}
    </div>
  );
}
