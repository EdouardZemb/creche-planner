/**
 * Conventional Commits (doc 03 §8). Les scopes restent libres pour coller à la
 * structure microservices : shared-kernel, contracts, svc-referentiel, api-gateway, ci…
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
  },
};
