import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import { moisDeLaSemaine } from '@creche-planner/shared-semaine';
import type { Database } from '../database/database.types.js';
import {
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
  STATUTS_ENVOI,
  STATUTS_ENVOI_RECAP,
  STATUTS_ENVOI_RECAP_PARENT,
} from '../database/schema.js';
import type {
  SuiviEnvoiEtablissement,
  SuiviEnvoisVue,
  SuiviRappelHebdo,
  SuiviRappelParent,
} from './envoi.dto.js';

/**
 * Service de **suivi des envois** (B1) — **LECTURE SEULE**. Pour une `(foyer, semaine)`,
 * il agrège l'état **persistant** des envois déjà journalisés par le scheduler et le
 * mail au service :
 *
 * - `envoi_recap_hebdo` (+ `envoi_recap_parent`) : le rappel du mardi aux parents ;
 * - `envoi_etablissement` : les récaps agrégés adressés aux établissements.
 *
 * Trois `select` simples par `(foyer_id, semaine_iso)`, mappés en camelCase. **Aucune
 * écriture** : cette surface rend seulement consultable une donnée déjà produite (le
 * résultat d'envoi ne vivait jusqu'ici que dans l'état React, perdu au reload). Les
 * transitions de statut restent l'affaire du scheduler et de `EnvoiService`.
 */
@Injectable()
export class SuiviEnvoisService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Suivi des envois d'une semaine (rappel aux parents + envois aux établissements). */
  async lire(foyerId: string, semaineIso: string): Promise<SuiviEnvoisVue> {
    const [rappels, parents, etablissements] = await Promise.all([
      this.db
        .select()
        .from(envoiRecapHebdo)
        .where(
          and(
            eq(envoiRecapHebdo.foyerId, foyerId),
            eq(envoiRecapHebdo.semaineIso, semaineIso),
          ),
        ),
      this.db
        .select()
        .from(envoiRecapParent)
        .where(
          and(
            eq(envoiRecapParent.foyerId, foyerId),
            eq(envoiRecapParent.semaineIso, semaineIso),
          ),
        ),
      this.db
        .select()
        .from(envoiEtablissement)
        .where(
          and(
            eq(envoiEtablissement.foyerId, foyerId),
            eq(envoiEtablissement.semaineIso, semaineIso),
          ),
        ),
    ]);

    // Slot du rappel : au plus une ligne (PK `(foyer, semaine)`). Sans slot, le récap
    // n'a jamais été programmé pour cette semaine → `rappel` nul (le front n'affiche
    // alors rien pour le rappel).
    const slot = rappels[0];
    const rappel: SuiviRappelHebdo | null = slot
      ? {
          statut: this.narrow(STATUTS_ENVOI_RECAP, slot.statut, 'rappel'),
          envoyeLe: slot.envoyeLe ? slot.envoyeLe.toISOString() : null,
          erreur: slot.erreur,
          parents: parents
            .map((p): SuiviRappelParent => ({
              email: p.email,
              statut: this.narrow(
                STATUTS_ENVOI_RECAP_PARENT,
                p.statut,
                'rappel parent',
              ),
              envoyeLe: p.envoyeLe ? p.envoyeLe.toISOString() : null,
              essais: p.essais,
            }))
            // Ordre déterministe (e-mail) pour une liste stable et testable.
            .sort((a, b) => a.email.localeCompare(b.email)),
        }
      : null;

    return {
      foyerId,
      semaineIso,
      rappel,
      etablissements: etablissements
        .map((e): SuiviEnvoiEtablissement => ({
          etablissementId: e.etablissementId,
          statut: this.narrow(STATUTS_ENVOI, e.statut, 'envoi établissement'),
          envoyeLe: e.envoyeLe ? e.envoyeLe.toISOString() : null,
          erreur: e.erreur,
          destinataire: e.destinataire,
        }))
        // Ordre déterministe (id d'établissement) pour une liste stable et testable.
        .sort((a, b) => a.etablissementId.localeCompare(b.etablissementId)),
    };
  }

  /**
   * Mois **communiqués** d'un foyer (SFD 30, US-30-05) : la liste des mois `YYYY-MM`
   * pour lesquels **au moins un** récap a réellement été envoyé à un établissement
   * (`envoi_etablissement.statut = 'ENVOYE'`). Chaque semaine envoyée est projetée sur
   * le/les mois qu'elle recouvre (`moisDeLaSemaine`, 1 ou 2 mois à cheval). Sert à
   * signaler « déjà envoyé à la crèche » avant une correction rétroactive. Bornage
   * optionnel `[du, au]` (mois `YYYY-MM` inclus) pour limiter à la période d'impact.
   * **Lecture seule.** DRY_RUN/ECHEC/EN_COURS ne comptent pas (rien n'a été communiqué).
   */
  async moisCommuniques(
    foyerId: string,
    du?: string,
    au?: string,
  ): Promise<{ mois: string[] }> {
    const lignes = await this.db
      .select({ semaineIso: envoiEtablissement.semaineIso })
      .from(envoiEtablissement)
      .where(
        and(
          eq(envoiEtablissement.foyerId, foyerId),
          eq(envoiEtablissement.statut, 'ENVOYE'),
        ),
      );
    const mois = new Set<string>();
    for (const ligne of lignes) {
      for (const m of moisDeLaSemaine(ligne.semaineIso)) {
        if ((du === undefined || m >= du) && (au === undefined || m <= au)) {
          mois.add(m);
        }
      }
    }
    return { mois: [...mois].sort() };
  }

  /** Renarrow d'un statut lu en base contre son ensemble de valeurs connues. */
  private narrow<T extends string>(
    connus: readonly T[],
    valeur: string,
    quoi: string,
  ): T {
    const connu = connus.find((s) => s === valeur);
    if (!connu) {
      throw new Error(`statut ${quoi} inconnu en base : ${valeur}`);
    }
    return connu;
  }
}
