import { useState } from 'react';
import { api } from '../api/client';
import type { NotificationAValider } from '../types/bff';
import { messageErreur } from '../utils/erreurs';
import { useNotifications } from './useNotifications';
import { RelectureEnvoi } from './RelectureEnvoi';

/** Rend `2026-W27` en libellé lisible « semaine 27 (2026) ». */
function libelleSemaine(semaineIso: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(semaineIso);
  if (!m) return semaineIso;
  return `semaine ${Number(m[2])} (${m[1]})`;
}

/**
 * Encart « Valider la semaine suivante » en tête du planning (Lot 4). Liste les
 * semaines `A_VALIDER` du foyer et propose de les valider d'un clic. Après une
 * validation, la liste se recharge (la semaine validée disparaît) et un message
 * indique si le planning a été validé tel quel ou **avec modifications**. Tant
 * qu'il n'y a rien à valider (cas nominal hors notification du mardi), l'encart
 * ne s'affiche pas — il n'encombre pas la page.
 */
export function EncartValidation({ foyerId }: { foyerId: string }) {
  const [version, setVersion] = useState(0);
  const { data, loading } = useNotifications(foyerId, version);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Semaine validée AVEC modifications : on propose alors d'envoyer le récap au
  // service concerné (relecture + envoi du Lot 6). `null` tant qu'aucune ne le requiert.
  const [aEnvoyer, setAEnvoyer] = useState<NotificationAValider | null>(null);

  // Chargement initial ou aucune semaine à valider : pas d'encart.
  if (loading && !data) return null;
  const semaines = data ?? [];
  if (semaines.length === 0) return null;

  const valider = async (n: NotificationAValider): Promise<void> => {
    setEnCours(n.semaineIso);
    setMessage(null);
    try {
      const resultat = await api.validerSemaine(n.contratId, n.semaineIso);
      const avecModifs = resultat.statut === 'VALIDEE_AVEC_MODIFS';
      setMessage(
        avecModifs
          ? `Planning de la ${libelleSemaine(n.semaineIso)} validé (avec modifications).`
          : `Planning de la ${libelleSemaine(n.semaineIso)} validé.`,
      );
      // Avec modifications, on doit prévenir le service : on garde la semaine pour
      // proposer la relecture/envoi (pas d'envoi automatique — relecture obligatoire).
      setAEnvoyer(avecModifs ? n : null);
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage(messageErreur(err));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <section
      className="carte"
      aria-label="Semaines de planning à valider"
      style={{ borderLeft: '4px solid var(--bleu)', marginBottom: '1rem' }}
    >
      <h2 style={{ marginTop: 0, fontSize: 'var(--h2)' }}>
        Valider la semaine suivante
      </h2>
      {message !== null && (
        <p className="credit" role="status">
          {message}
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {semaines.map((n) => (
          <li
            key={`${n.contratId}-${n.semaineIso}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              padding: '0.4rem 0',
            }}
          >
            <span>Planning de la {libelleSemaine(n.semaineIso)}</span>
            <button
              type="button"
              className="btn"
              disabled={enCours === n.semaineIso}
              onClick={() => {
                void valider(n);
              }}
            >
              {enCours === n.semaineIso ? 'Validation…' : 'Valider'}
            </button>
          </li>
        ))}
      </ul>

      {aEnvoyer && (
        <RelectureEnvoi
          contratId={aEnvoyer.contratId}
          semaineIso={aEnvoyer.semaineIso}
        />
      )}
    </section>
  );
}
