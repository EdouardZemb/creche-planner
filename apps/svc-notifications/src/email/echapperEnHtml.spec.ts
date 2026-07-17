import { describe, expect, it } from 'vitest';
import { echapperEnHtml } from './echapperEnHtml.js';

describe('echapperEnHtml', () => {
  it('échappe les caractères HTML dangereux (aucune balise du client interprétée)', () => {
    const html = echapperEnHtml('<b>coucou</b> & <script>alert(1)</script>');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;coucou&lt;/b&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('échappe guillemets doubles et simples', () => {
    const html = echapperEnHtml(`dit "bonjour" à l'école`);
    expect(html).toContain('&quot;bonjour&quot;');
    expect(html).toContain('&#39;');
    expect(html).not.toContain('"bonjour"');
  });

  it('convertit les retours à la ligne en <br /> (LF, CRLF et CR)', () => {
    expect(echapperEnHtml('ligne1\nligne2')).toBe(
      '<div>ligne1<br />\nligne2</div>',
    );
    expect(echapperEnHtml('ligne1\r\nligne2')).toBe(
      '<div>ligne1<br />\nligne2</div>',
    );
    expect(echapperEnHtml('ligne1\rligne2')).toBe(
      '<div>ligne1<br />\nligne2</div>',
    );
  });

  it('enveloppe le résultat dans un conteneur HTML minimal', () => {
    const html = echapperEnHtml('bonjour');
    expect(html).toBe('<div>bonjour</div>');
  });

  it('gère le texte vide sans planter', () => {
    expect(echapperEnHtml('')).toBe('<div></div>');
  });
});
