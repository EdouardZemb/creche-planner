import { describe, expect, it } from 'vitest';
import { estAdmin, estGatingAdminActif, normaliserEmail } from './admin.js';

describe('admin — helpers de rôle (PR6, option b-ii)', () => {
  describe('estGatingAdminActif', () => {
    it('est inactif sur une allowlist vide (opt-in)', () => {
      expect(estGatingAdminActif([])).toBe(false);
    });

    it('est actif dès qu’un e-mail est présent', () => {
      expect(estGatingAdminActif(['admin@example.test'])).toBe(true);
    });
  });

  describe('estAdmin', () => {
    const liste = ['admin@example.test', 'chef@example.test'];

    it('reconnaît un e-mail présent (insensible à la casse / espaces)', () => {
      expect(estAdmin('admin@example.test', liste)).toBe(true);
      expect(estAdmin('  Admin@Example.TEST ', liste)).toBe(true);
    });

    it('rejette un e-mail absent', () => {
      expect(estAdmin('intrus@example.test', liste)).toBe(false);
    });

    it('rejette une identité absente ou vide', () => {
      expect(estAdmin(undefined, liste)).toBe(false);
      expect(estAdmin('   ', liste)).toBe(false);
    });

    it('rejette tout face à une allowlist vide (jamais admin par défaut)', () => {
      expect(estAdmin('admin@example.test', [])).toBe(false);
    });
  });

  describe('normaliserEmail', () => {
    it('trim + minuscule', () => {
      expect(normaliserEmail('  Foo@Bar.Test ')).toBe('foo@bar.test');
    });
  });
});
