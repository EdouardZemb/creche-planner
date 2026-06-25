import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  etablissementDestinataire,
  type EtablissementRow,
  type PreavisRegle,
} from '../database/schema.js';
import {
  CLES_ETABLISSEMENT,
  type CleEtablissement,
  type UpsertEtablissementDto,
} from './etablissement.dto.js';

/** Vue lisible d'un établissement destinataire (sans colonnes techniques). */
export interface EtablissementVue {
  readonly cle: CleEtablissement;
  readonly libelle: string;
  readonly emailService: string;
  readonly preavisRegle: PreavisRegle;
  readonly actif: boolean;
}

/** Valeurs de seed d'un établissement (préavis + libellé par défaut). */
interface SeedEtablissement {
  readonly cle: CleEtablissement;
  readonly libelle: string;
  readonly emailService: string;
  readonly preavisRegle: PreavisRegle;
}

/**
 * Seed des **2 établissements** (idempotent). Les adresses sont des placeholders
 * non-prod : l'envoi réel est garde-fou par le mailer (dry-run par défaut +
 * allowlist, Lot 2) et les vraies adresses sont saisies via l'écran d'édition. Les
 * règles de préavis reflètent les specs : 2 jours ouvrés crèche (RM-03), jeudi
 * 12h ABCM (RM-07).
 */
const SEED: readonly SeedEtablissement[] = [
  {
    cle: 'CRECHE_HIRONDELLES',
    libelle: 'Crèche Les Hirondelles',
    emailService: 'contact-creche@example.org',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  },
  {
    cle: 'ABCM',
    libelle: 'École ABCM',
    emailService: 'contact-abcm@example.org',
    preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
  },
];

@Injectable()
export class EtablissementService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EtablissementService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Seede les établissements au démarrage (après les migrations, exécutées en
   * `onModuleInit`). Idempotent via `onConflictDoNothing` sur la clé : ne réécrase
   * jamais une adresse/règle déjà personnalisée. Tolérant à une base indisponible
   * (loggue et continue : la liste reste éditable une fois la base revenue).
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const e of SEED) {
        await this.db
          .insert(etablissementDestinataire)
          .values({
            id: randomUUID(),
            cle: e.cle,
            libelle: e.libelle,
            emailService: e.emailService,
            preavisRegle: e.preavisRegle,
            actif: true,
          })
          .onConflictDoNothing({ target: etablissementDestinataire.cle });
      }
      this.logger.log('Établissements destinataires seedés (idempotent)');
    } catch (erreur) {
      this.logger.warn(
        `Seed des établissements impossible (${(erreur as Error).message}) — ignoré`,
      );
    }
  }

  /**
   * Résout un établissement par sa clé (destinataire du mail de service, Lot 6).
   * Renvoie `undefined` si la clé n'est pas (ou plus) en base — l'appelant décide
   * alors comment dégrader (404 côté envoi).
   */
  async parCle(cle: CleEtablissement): Promise<EtablissementVue | undefined> {
    const lignes = await this.db
      .select()
      .from(etablissementDestinataire)
      .where(eq(etablissementDestinataire.cle, cle));
    const ligne = lignes[0];
    return ligne ? this.versVue(ligne) : undefined;
  }

  /** Liste les établissements destinataires (ordre alphabétique de clé). */
  async lister(): Promise<EtablissementVue[]> {
    const lignes = await this.db
      .select()
      .from(etablissementDestinataire)
      .orderBy(asc(etablissementDestinataire.cle));
    return lignes.map((l) => this.versVue(l));
  }

  /**
   * Upsert d'un établissement par clé : met à jour l'adresse et la règle de
   * préavis (et `libelle`/`actif` si fournis) ; crée la ligne si absente (libellé
   * = clé, actif = vrai par défaut). Idempotent sur la clé unique.
   */
  async upsert(
    cle: CleEtablissement,
    dto: UpsertEtablissementDto,
  ): Promise<EtablissementVue> {
    const lignes = await this.db
      .insert(etablissementDestinataire)
      .values({
        id: randomUUID(),
        cle,
        libelle: dto.libelle ?? cle,
        emailService: dto.emailService,
        preavisRegle: dto.preavisRegle,
        actif: dto.actif ?? true,
      })
      .onConflictDoUpdate({
        target: etablissementDestinataire.cle,
        set: {
          emailService: dto.emailService,
          preavisRegle: dto.preavisRegle,
          ...(dto.libelle !== undefined ? { libelle: dto.libelle } : {}),
          ...(dto.actif !== undefined ? { actif: dto.actif } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    const ligne = lignes[0];
    if (!ligne) {
      throw new Error(`upsert établissement échoué : ${cle}`);
    }
    return this.versVue(ligne);
  }

  private versVue(ligne: EtablissementRow): EtablissementVue {
    return {
      // La colonne est contrainte au seed/upsert : la clé en base est l'une des
      // `CLES_ETABLISSEMENT`. On la renarrow à la frontière de lecture.
      cle: this.cle(ligne.cle),
      libelle: ligne.libelle,
      emailService: ligne.emailService,
      preavisRegle: ligne.preavisRegle,
      actif: ligne.actif,
    };
  }

  /** Renarrow d'une clé lue en base vers le type `CleEtablissement`. */
  private cle(valeur: string): CleEtablissement {
    const connue = CLES_ETABLISSEMENT.find((c) => c === valeur);
    if (!connue) {
      throw new Error(`clé d'établissement inconnue en base : ${valeur}`);
    }
    return connue;
  }
}
