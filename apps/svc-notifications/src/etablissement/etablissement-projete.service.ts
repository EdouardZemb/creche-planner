import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  etablissement,
  type EtablissementProjeteRow,
  type PreavisRegle,
} from '../database/schema.js';

/**
 * Vue lisible de la **fiche établissement projetée** (read model `etablissement`,
 * alimenté par `svc-planification` via le `ProjectionService`). Identifiée par l'`id`
 * réel de l'établissement (entité libre par foyer), elle porte un `emailService` /
 * `preavisRegle` **facultatifs** (l'event ne les transporte que s'ils sont renseignés).
 */
export interface EtablissementProjeteVue {
  readonly id: string;
  readonly foyerId: string;
  readonly nom: string;
  readonly emailService: string | null;
  readonly preavisRegle: PreavisRegle | null;
  readonly actif: boolean;
}

/**
 * Lecture du **read model des établissements** (entité libre par foyer, P3). Source de
 * vérité : `svc-planification`, projetée dans la table locale `etablissement` (cf.
 * `ProjectionService`). Le destinataire et la règle de préavis des récaps sont résolus
 * à partir du lien explicite `contrat.etablissement_id` (l'ancien annuaire à clé fermée
 * et le mapping codé `mode → clé` ont été démantelés en P6).
 */
@Injectable()
export class EtablissementProjeteService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Résout une fiche établissement par son `id` réel (destinataire du récap, routé par
   * `contrat.etablissement_id`). Renvoie `undefined` si la fiche n'est pas (ou plus)
   * projetée — l'appelant décide alors comment dégrader (404 côté envoi).
   */
  async parId(id: string): Promise<EtablissementProjeteVue | undefined> {
    const lignes = await this.db
      .select()
      .from(etablissement)
      .where(eq(etablissement.id, id));
    const ligne = lignes[0];
    return ligne ? this.versVue(ligne) : undefined;
  }

  /** Liste toutes les fiches projetées (ordre stable par `id`, pour un annuaire indexé). */
  async lister(): Promise<EtablissementProjeteVue[]> {
    const lignes = await this.db
      .select()
      .from(etablissement)
      .orderBy(asc(etablissement.id));
    return lignes.map((l) => this.versVue(l));
  }

  private versVue(ligne: EtablissementProjeteRow): EtablissementProjeteVue {
    return {
      id: ligne.id,
      foyerId: ligne.foyerId,
      nom: ligne.nom,
      emailService: ligne.emailService,
      preavisRegle: ligne.preavisRegle,
      actif: ligne.actif,
    };
  }
}
