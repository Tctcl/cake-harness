/**
 * Kept in sync with `.github/workflows/commits.yml`: that workflow validates the
 * pull request title, this one validates the local commit message.
 */
export default {
  extends: ['@commitlint/config-conventional'],
};
