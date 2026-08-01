import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChampFormulaire } from './ChampFormulaire';

describe('ChampFormulaire', () => {
  it('lie le label au contrôle et ne pose aucun attribut ARIA sans erreur', () => {
    render(
      <ChampFormulaire id="contrat-valideDu" libelle="Valide du">
        {(champ) => <input type="date" {...champ} />}
      </ChampFormulaire>,
    );
    const champ = screen.getByLabelText('Valide du');
    expect(champ).toHaveAttribute('id', 'contrat-valideDu');
    // Variante 1 : ni aide ni erreur → l'attribut est ABSENT, pas vide.
    expect(champ).not.toHaveAttribute('aria-describedby');
    expect(champ).not.toHaveAttribute('aria-invalid');
    expect(champ).not.toHaveAttribute('aria-required');
  });

  it('pose aria-required indépendamment du required HTML', () => {
    // Trois combinaisons existent dans le repo, dont « aria-required seul »
    // (blocs facultatifs parents/enfants) : les deux ne doivent pas être liés.
    render(
      <ChampFormulaire id="parent-email" libelle="E-mail" requis>
        {(champ) => <input type="email" {...champ} />}
      </ChampFormulaire>,
    );
    const champ = screen.getByLabelText('E-mail');
    expect(champ).toHaveAttribute('aria-required', 'true');
    // `toBeRequired` compte `aria-required` : on vise l'attribut HTML lui-même.
    expect(champ).not.toHaveAttribute('required');
  });

  it('relie l’erreur au contrôle, avec un id DÉCOUPLÉ de celui du contrôle', () => {
    render(
      <ChampFormulaire
        id="enfant-naissance"
        libelle="Date de naissance"
        erreur="Date invalide"
        idErreur="enfant-dateNaissance-err"
      >
        {(champ) => <input type="date" {...champ} />}
      </ChampFormulaire>,
    );
    const champ = screen.getByLabelText('Date de naissance');
    expect(champ).toHaveAttribute('aria-invalid', 'true');
    // Le patron que sept tests existants exercent : aria-describedby porte UN
    // seul id, que getElementById doit résoudre vers le message.
    const idDecrit = champ.getAttribute('aria-describedby');
    expect(idDecrit).toBe('enfant-dateNaissance-err');
    const message =
      idDecrit === null ? null : document.getElementById(idDecrit);
    expect(message).toHaveTextContent('Date invalide');
    expect(message).toHaveAttribute('role', 'alert');
  });

  it('n’émet jamais aria-invalid="false" quand le champ est valide', () => {
    render(
      <ChampFormulaire id="rfr" libelle="RFR" erreur={null} idErreur="rfr-err">
        {(champ) => <input {...champ} />}
      </ChampFormulaire>,
    );
    expect(screen.getByLabelText('RFR')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('compose aide puis erreur dans aria-describedby, dans cet ordre', () => {
    render(
      <ChampFormulaire
        id="etab-email"
        libelle="E-mail du service"
        aide="Utilisé pour envoyer le récapitulatif."
        idAide="etab-email-aide"
        erreur="Adresse invalide"
        idErreur="etab-emailService-err"
      >
        {(champ) => <input type="email" {...champ} />}
      </ChampFormulaire>,
    );
    expect(screen.getByLabelText('E-mail du service')).toHaveAttribute(
      'aria-describedby',
      'etab-email-aide etab-emailService-err',
    );
  });

  it('lie l’aide seule quand il n’y a pas d’erreur', () => {
    render(
      <ChampFormulaire
        id="etab-email"
        libelle="E-mail du service"
        aide="Utilisé pour envoyer le récapitulatif."
        idAide="etab-email-aide"
        idErreur="etab-emailService-err"
      >
        {(champ) => <input type="email" {...champ} />}
      </ChampFormulaire>,
    );
    expect(screen.getByLabelText('E-mail du service')).toHaveAttribute(
      'aria-describedby',
      'etab-email-aide',
    );
  });

  it('rend label, contrôle et message en FRÈRES, sans conteneur intercalé', () => {
    // Un <div> ici casserait `label { display: block }` et `.champs-duo > *`.
    const { container } = render(
      <ChampFormulaire
        id="nbParts"
        libelle="Nombre de parts"
        erreur="Valeur invalide"
        idErreur="nbParts-err"
      >
        {(champ) => <input type="number" {...champ} />}
      </ChampFormulaire>,
    );
    const enfants = Array.from(container.children).map((el) => el.tagName);
    expect(enfants).toEqual(['LABEL', 'INPUT', 'SPAN']);
  });

  it('garde le marqueur d’obligation hors du nom accessible', () => {
    render(
      <ChampFormulaire
        id="etab-nom"
        libelle={
          <>
            Nom <span aria-hidden="true">*</span>
          </>
        }
      >
        {(champ) => <input {...champ} />}
      </ChampFormulaire>,
    );
    // `getByLabelText` lit le textContent du label (« Nom * ») ; c'est le NOM
    // ACCESSIBLE, calculé par le rôle, qui doit exclure le marqueur aria-hidden.
    expect(screen.getByRole('textbox', { name: 'Nom' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nom *')).toBeInTheDocument();
  });
});
