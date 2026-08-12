import { useId, useState } from 'react';
import { api } from '../api/client';
import { messageErreur } from '../utils/erreurs';
import { telechargerJson } from '../utils/telechargement';
import { Bouton } from '../ui/Bouton';
import { ChampErreur } from '../ui/ChampErreur';

/**
 * Nom du fichier proposé au téléchargement. L'identifiant du foyer est
 * **tronqué** : un nom de fichier circule (dossier de téléchargement, pièce
 * jointe, capture d'écran), il n'a pas à porter un identifiant complet. Huit
 * caractères suffisent à distinguer deux exports.
 *
 * La date vient du document lui-même (`genereLe`), pas de l'horloge du
 * navigateur : le fichier est daté de sa **production**, et deux personnes qui
 * ouvrent le même export ne le nomment pas différemment.
 */
export function nomFichierExport(foyerId: string, genereLe: string): string {
  return `donnees-foyer-${foyerId.slice(0, 8)}-${genereLe.slice(0, 10)}.json`;
}

/**
 * **Export des données personnelles de la famille** (droit à la portabilité,
 * lot 3 ; `AM-35`).
 *
 * Trois partis pris d'écran :
 *
 * 1. **Le contenu est annoncé avant le clic**, pas après. Un export dont on ne
 *    sait pas ce qu'il contient n'est pas un droit exercé, c'est un fichier.
 * 2. **Aucune confirmation** : contrairement à l'effacement voisin, télécharger
 *    ses propres données ne casse rien et n'a pas à être freiné.
 * 3. **L'échec est affiché, jamais silencieux.** La passerelle interroge trois
 *    services et refuse de livrer un export amputé : si l'un d'eux ne répond
 *    pas, il n'y a pas de fichier, et la page le dit plutôt que de télécharger
 *    un document incomplet qui aurait l'air normal.
 */
export function ExportDonneesFoyer({ foyerId }: { readonly foyerId: string }) {
  const idBase = useId();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function exporter() {
    setOccupe(true);
    setErreur(null);
    try {
      const document = await api.exporterFoyer(foyerId);
      telechargerJson(nomFichierExport(foyerId, document.genereLe), document);
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="mt-5" aria-labelledby={`${idBase}-titre`}>
      <h2 id={`${idBase}-titre`}>Récupérer vos données</h2>
      <p className="muted">
        Vous pouvez télécharger, dans un seul fichier, tout ce que l’application
        a enregistré pour cette famille : ressources et leur historique,
        enfants, parents, contrats de garde et avenants, plannings saisis,
        établissements, préférences de rappel, et les messages qui vous ont été
        envoyés comme ceux envoyés aux établissements.
      </p>
      <p className="muted">
        Le fichier est au format JSON, lisible tel quel dans un éditeur de
        texte. Il contient des données personnelles : conservez-le comme tel.
      </p>

      <ChampErreur balise="p">{erreur}</ChampErreur>

      <Bouton
        variante="secondaire"
        disabled={occupe}
        onClick={() => void exporter()}
      >
        {occupe ? 'Préparation du fichier…' : 'Télécharger mes données'}
      </Bouton>
    </section>
  );
}
