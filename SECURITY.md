# Security Policy

## Supported versions

This project is pre-1.0 and ships from `main`. Only the latest release line
receives security fixes.

| Version | Supported |
| --- | --- |
| latest `0.x` release | ✅ |
| any older `0.x` | ❌ — upgrade to the latest release |

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion.** A public report tells
everyone, including people who would exploit it, before a fix exists.

Report privately through either channel:

1. **GitHub private vulnerability reporting** — repository → *Security* →
   *Report a vulnerability*. This creates a private advisory and a temporary
   private fork for the fix. Preferred, because the whole disclosure stays on
   one platform.
2. **Email [security@tctcl.de](mailto:security@tctcl.de)** if you cannot use
   GitHub, or the report also affects something outside this repository.

Please include:

- what is affected (workspace, route, dependency) and the version or commit,
- the impact you believe it has,
- reproduction steps or a proof of concept,
- whether you intend to publish the finding, and on what timeline.

## What happens next

This is a maintainer-run project without a paid on-call rotation, so the
following are targets, not guarantees:

| Step | Target |
| --- | --- |
| Acknowledgement of your report | within 7 days |
| Initial assessment and severity call | within 14 days |
| Fix or mitigation for a confirmed issue | as soon as practical, coordinated with you |
| Public disclosure | after a fix is released, credit given unless you ask otherwise |

The process is deliberately small: triage the report, decide severity, prepare
the fix on a private branch, release a patch through the normal release pipeline
(a `fix:` commit reaches the changelog automatically), then publish the advisory
and credit the reporter.

## Scope

In scope: the code in this repository — the apps under `apps/`, the shared
configuration under `packages/`, the workflows under `.github/`, and the
dependency set pinned by `pnpm-lock.yaml`.

Out of scope: vulnerabilities in third-party dependencies that you have not
demonstrated affect this project (report those upstream), anything requiring
physical access to the maintainer's machine, and findings from automated scanners
with no demonstrated impact.

## Automated checks

There is no continuous security scanning beyond what GitHub provides: Renovate
opens npm update pull requests weekly (`renovate.json`), Dependabot does the same
for GitHub Actions and Docker images (`.github/dependabot.yml`), and GitHub's
dependency graph alerts on known advisories. There is no SAST or secret-scanning
gate in CI yet — this section must be updated if one is added.
