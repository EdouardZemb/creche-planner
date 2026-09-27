# Test strategy

> English companion to the governed French sources — the test policy and strategy
> ([doc 21](docs/21-politique-strategie-test.md)), the test plan
> ([doc 20](docs/20-plan-de-test.md)), and the self-assessment against ISTQB CTAL-TM /
> TMMi ([doc 18](docs/18-audit-gestion-tests-ctal-tm-tmmi.md)). Those documents are
> authoritative; this page explains the reasoning to a reader arriving cold.

## The one idea

**A passing test suite is a claim, not evidence.** Everything below exists to make the
claim falsifiable: mutation testing proves the unit tests detect defects, contract
tests prove two services still agree, negative probes prove the quality gates
themselves still bite, and traceability proves no requirement is quietly untested.

The domain is money. A wrong childcare invoice is not a cosmetic defect — it is a
wrong amount charged to a family, discovered a month later. That risk sets the depth.

## Shape of the pyramid

Deliberately **base-heavy**, and not inverted:

```
                  ┌───────────────────────────┐
                  │  E2E real stack (thin)    │   Playwright + 27 containers
                  ├───────────────────────────┤
                  │  E2E mocked BFF           │   Playwright, deterministic
                  ├───────────────────────────┤
                  │  Contract (Pact) · schema │   5 consumer-driven pacts
                  ├───────────────────────────┤
                  │  Integration              │   real Postgres + NATS, outbox
                  ├───────────────────────────┴──┐
                  │  Unit / domain + model-based │  100 % covered, mutation-tested
                  └──────────────────────────────┘
```

The pure domain libraries (`libs/*/domain`, `libs/shared-kernel`) carry the pricing
arithmetic with **no framework, no I/O and no database**. That purity is what makes
100 % coverage and mutation testing affordable at this level — and what keeps the
expensive top of the pyramid thin.

## Level by level

### 1. Unit / domain — Vitest

Thresholds are **enforced in `vitest.config.mts`**, not aspirational: `statements`,
`branches`, `functions` and `lines` at **100 %** for the four domain libraries. Types-only
files are excluded explicitly (no executable code, so no reachable branch), and the
exclusion is justified in the config rather than hidden behind a glob.

Workspace-wide, coverage is additionally **ratcheted**: `coverage-compare.mjs` fetches
the rolling baseline from the last `main` run and fails any project losing more than
**0.5 point** of line coverage. The 0.5 absorbs rounding noise while still blocking a
real regression.

### 2. Model-based testing — ~260 cases and properties

The schedule and adjustment logic is a state machine, so it is tested as one rather
than by example-guessing ([doc 17](docs/17-tests-model-based-ct-mbt.md)). Four
techniques, each chosen for what it finds:

| Technique                          | Applied to                                     | Finds                                         |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| **State machines**                 | Day-of-care state, schedule adjustment scope   | Illegal transitions, unreachable states       |
| **Decision tables**                | Absence-deduction eligibility, band selection  | Unhandled rule combinations                   |
| **BVA / equivalence partitioning** | Hour thresholds, income bands, effective dates | Off-by-one at every boundary                  |
| **Property-based**                 | Consolidation invariants `INV-01..08`          | Violations no example test was going to guess |

The eight business invariants `INV-01..08` are traced to their tests explicitly — a
risk, a named invariant, a test.

### 3. Mutation testing — Stryker

The level that distinguishes this repository. Stryker rewrites the production code
(flips a comparison, drops a clause, changes a constant) and re-runs the suite for
each mutant. A mutant that **survives** is a line the tests execute but do not
actually check.

Scope: the four pure-domain libraries. Configuration
([`libs/*/domain/stryker.config.mjs`](libs/tarification/domain/stryker.config.mjs))
sets `thresholds: { high: 90, low: 80, break: 80 }` — under 80 % the run fails.

Measured scores, all four libraries, run 2026-09-27:

| Library                                                 | Mutation score | Against a `break` threshold of |
| ------------------------------------------------------- | -------------- | ------------------------------ |
| `libs/tarification/domain` — the money-calculating core | **96.14 %**    | 80 %                           |
| `libs/foyer/domain`                                     | **92.31 %**    | 80 %                           |
| `libs/referentiel/domain`                               | **88.24 %**    | 80 %                           |
| `libs/planification/domain`                             | **87.27 %**    | 80 %                           |

The highest score is on the pricing consolidation, which is the intended ordering: the
code that decides an amount is the code whose tests must be provably sensitive.

Run it yourself:

```bash
pnpm nx run tarification-domain:mutation   # also: planification-, foyer-, referentiel-domain
```

It runs **weekly and on demand**, not on every pull request — each mutant replays the
suite that covers it, which is far too slow for PR feedback. That is a deliberate
trade-off: the signal is triaged, it never blocks a branch, and HTML/JSON reports are
retained 90 days as a time series.

### 4. Contract testing — Pact, consumer-driven

The BFF is the consumer; the five services are the providers. Three mechanisms keep
them honest:

- **Pacts are regenerated from scratch** on every pull request from the gateway's
  consumer tests, then compared to the committed files in [`pacts/`](pacts/). Any
  drift fails the build — a contract cannot be edited to match a broken
  implementation.
- **`can-i-deploy`** gates the release against the file-based registry (ADR-0005
  explains why committed pacts beat a hosted broker for a single-maintainer project).
- **OpenAPI → TypeScript drift**: the front-end types are regenerated from the BFF
  contract and diffed byte-for-byte. A silently breaking API change cannot reach the
  web app.

### 5. Integration — real infrastructure

Real Postgres and real NATS, never a mock of either. This level exists for the things
only real infrastructure exhibits: transactional **outbox** delivery, **idempotent
durable consumers** reprocessing the same event, and projection rebuilds. A lesson
learned the hard way and written down: a faked `db` object proves nothing about a
query.

### 6. End-to-end — two suites, two purposes

| Suite            | Backend                             | Purpose                                                              |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `nx e2e web`     | Mocked BFF                          | Fast, deterministic journey coverage — the one that runs constantly  |
| `pnpm e2e:stack` | The full 27-container stack, seeded | Proves the journeys survive real services, real events, real latency |

Environments are **versioned and ephemeral**: `docker compose up` from the committed
files, an **idempotent seed** with a `--verify` oracle
([`scripts/seed-demo.mjs`](scripts/seed-demo.mjs)), and systematic `down -v` teardown.
No hand-maintained shared test environment to drift.

### 7. Accessibility — WCAG 2.2 AA

axe-core through Playwright, plus something an automated audit cannot give: the nine
criteria **new to WCAG 2.2** are each individually adjudicated in
[doc 11](docs/11-spec-accessibilite-ct-ut.md) §8, and `pnpm wcag` checks that every
guard cited there exists in a test — and that the axe audit really requests the
`wcag22aa` tag. Without that tag it stays green while looking at nothing from 2.2.

That gate exists because of a genuine finding: the axe audit was passing while
examining neither 2.2 nor the mobile layout. A green tool is not a green product.

### 8. Non-functional

- **Performance smoke** on the annual-cost endpoint, with a latency budget, on every PR.
- **Visual regression** via screenshot fingerprints — a CSS refactor must prove
  pixel-equivalence before it lands.
- **Security**: Trivy (SCA on the dependency tree and the built images), CodeQL,
  Semgrep, gitleaks secret scanning, cosign image signing — plus a daily re-scan of
  **already-deployed** images that distinguishes "fixed in source, redeploy is enough"
  from "still to be written".

## What is measured, and reported

Three KPIs were kept, on the honest ground that the others are not yet historised:

| KPI                           | Target / state                                     | Source                                            |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| **Domain coverage**           | **100 %**, enforced                                | Blocking vitest thresholds + CI lcov artefacts    |
| **Defects found in real use** | Trend down; every defect becomes a regression test | [Anomaly register](docs/22-registre-anomalies.md) |
| **E2E flakiness**             | ≈ 0; every instability traced                      | Playwright JUnit reports, summarised per run      |

Every CI run publishes a test-metrics summary and an E2E flakiness summary to the job
summary, with JUnit and coverage artefacts attached.

## Traceability, both directions

Requirements are identified (`CT-xx` for design/component, `UT-xx` for unit) and
`pnpm tracabilite` verifies the mapping **in both directions**: no requirement without
a test, and no test claiming a requirement that does not exist. One-way traceability
only catches the first failure mode, and the second one — a test pointing at a deleted
requirement — is how a suite quietly stops covering what it claims.

## Risk-based depth

Depth is allocated by the [product risk register](docs/19-registre-risque-produit.md)
(probability × impact → level → mitigating tests), not spread uniformly. The pricing
consolidation and the effective-date versioning get mutation testing and property-based
invariants; a static legal-notice page gets a smoke assertion. Uniform effort would
mean under-testing the invoice and over-testing the footer.

## Testing the tests: negative probes

Every quality gate ships an `--autotest` mode that **deliberately damages its own
input in memory** and asserts the gate goes red. This came from a real failure: a gate
was green for weeks because its scan had silently stopped matching anything, and it was
therefore guarding nothing. A gate that cannot fail is not a gate.

Two rules follow, and they are the habits I would bring to a team:

1. **Read the output of the tool that supposedly guards the subject, not just its
   code.** Most expensive defects in this repository were found this way.
2. **A gate declares what it does not cover.** [Doc 34
   §5](docs/34-registre-ameliorations.md) is the map of every gate with two columns no
   other document carries: its blind spots, and its negative probe.

## Running it

```bash
pnpm check                                 # lint + type-check + test + build, coverage ratcheted
pnpm nx run tarification-domain:mutation   # mutation testing on the pricing core
pnpm nx e2e web                            # E2E against a mocked BFF
pnpm e2e:stack                             # E2E against the full local stack
pnpm tracabilite && pnpm wcag              # traceability and accessibility gates
```

Contribution workflow and the full gate list: [CONTRIBUTING.md](CONTRIBUTING.md) and
the [README](README.md#quality-gates).
