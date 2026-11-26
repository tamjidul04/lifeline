# LifeLine: emergency blood supply coordination

Hack the Vibe 2026 · **World Problem Solver Track** · Advanced challenges: **A05** (Concurrency & Transaction Management) and **A02** (Intelligent Decisions & Optimization)

**Live app:** https://lifeline-eta-five.vercel.app

## The problem

In an emergency, hospitals phone around to find compatible blood. Units expire unused, the same unit can be promised twice, and nobody can say why one unit was chosen over another.

LifeLine lets a hospital request blood, matches compatible units across blood banks with explicit rules, reserves them so that no unit is ever promised twice, and explains every decision, including why a request cannot be met.

> Demonstration software. It is not a medical device and its rules have not been clinically validated. All data is fictional.

## Who uses it

| Role | Can do |
|---|---|
| Hospital staff | Preview a match, create and cancel its own requests, see its own requests only |
| Blood bank | Manage its own stock, see requests that hold its bags, mark bags delivered |
| Donor | Self-register, see donation eligibility (90-day rule) |
| Administrator | View all stock and requests, create hospital/bank accounts, read the audit log, reset demo data |

Test accounts are shared with the judging panel privately. No passwords are stored in this repository.

## Main workflow

1. A hospital opens **New request**. The preview shows what the engine would reserve, from current stock.
2. On submit, the engine runs again inside a database transaction and reserves the chosen units.
3. Each bank holding a unit sees the request and marks its bag **delivered**. When every held bag is delivered, the request is **Delivered**.
4. Cancelling releases held bags back to stock. Every change is written to the audit log.

Three connected modules: **Inventory**, **Requests** and **Matching**.

## A05: concurrency and transactions

*Test: many users request the final available unit.* Try it on the **Judge demo** page, or run `npm run race`.

Creating a request is one read-committed transaction (`lib/requests.ts`):

1. A per-hospital advisory lock makes the idempotency check and request limits race-free.
2. The engine plans on current stock, then locks **only the units it picked** with `SELECT … FOR UPDATE SKIP LOCKED`, re-checking availability in the same statement.
3. A unit held by another in-flight request is skipped and excluded, and the plan is recomputed. Requests for the same blood group run in parallel instead of queueing. The loser of a last-unit race is told immediately, with alternatives.
4. A **partial unique index** (`one ACTIVE or DELIVERED reservation per unit`) is the database-level guarantee. A double reservation is impossible even if the application logic were wrong.

Also:
- **Idempotency:** every create needs an `Idempotency-Key`. Same key and body replays the original; same key with a different body is `409`.
- **Cancel vs deliver:** both lock the request row first, read status after the lock, and are safe to repeat. Exactly one of the two wins.
- **Recovery:** lock timeouts, deadlocks and a full connection pool are retried with backoff. If still busy, the API answers `503 BUSY` with `Retry-After`.

Verified against the live deployment: 100 rounds of 10 parallel hospitals, with 0 invariant violations (`scripts/race-test.ts`).

## A02: intelligent, explainable decisions

*Test: conflicting constraints or an infeasible request.* Try both buttons on the **Judge demo** page.

`lib/rules.ts` is a pure, deterministic engine:

1. **Hard constraints** decide what is possible: compatibility table, component, not expired, will not expire before the courier arrives (30 min handling + 40 km/h), and the urgency policy.
2. **Soft preferences** rank the possible units. Each term is scaled to 0–1:

| Term | Weight | Why |
|---|---|---|
| Expires sooner | 0.35 | Use first-expiry-first to reduce wastage |
| Exact match | 0.30 | Keeps substitutes for patients with no other option |
| Closer bank | 0.20 | Arrives sooner |
| Spares universal units | 0.15 | Does not spend O− red cells or AB plasma unnecessarily |

3. **Optimisation:** after the best units are picked, a local search swaps single units when that lowers the number of banks that must deliver (penalty 0.25 per extra bank) without losing more in preference score.
4. **Explanations:** each unit gets a sentence. A request that cannot be fully met says why, and offers concrete options: partial supply now, what a higher urgency would unlock, farther banks with stock, and eligible donors to call.

Same input, same answer: ties break by expiry then id.

| Urgency | Substitutes allowed | Distance limit |
|---|---|---|
| Critical | yes | none |
| Urgent | yes | substitutes within 50 km |
| Routine | no | 50 km |

Urgency decides **whether** substitutes may be used, never **which** types are compatible.

### Compatibility tables (`lib/compat.ts`, the single source)

Red cells, "patient ← can receive":

| Patient | Can receive |
|---|---|
| O− | O− |
| O+ | O+, O− |
| A− | A−, O− |
| A+ | A+, A−, O+, O− |
| B− | B−, O− |
| B+ | B+, B−, O+, O− |
| AB− | AB−, A−, B−, O− |
| AB+ | all eight |

Plasma follows the reverse ABO rule and ignores Rh (O patients: O, A, B, AB; A: A, AB; B: B, AB; AB: AB). Platelets: same ABO group preferred, any type allowed as a substitute. All 64 cells of the red-cell and plasma tables are tested against an independent derivation from antigen rules.

Donors give red cells, so donor suggestions always use the red-cell table, and appear only for red-cell shortfalls.

## Request states

`OPEN → MATCHED | PARTIAL | UNFULFILLABLE` · `MATCHED/PARTIAL → DELIVERED | CANCELLED` · `UNFULFILLABLE → CANCELLED`. Anything else is rejected with `409` (`lib/state.ts`).

## Security

- bcrypt password hashes. The cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 hours.
- Sessions are server-side rows: signing out or resetting revokes a copied cookie immediately.
- Every API route checks role and ownership. Another organisation's record returns `404`, so ids cannot be probed.
- Self-registration creates donors only. Admin accounts cannot be created through the API.
- Cross-site state-changing requests are blocked. Failed logins are rate limited per account and per IP.

## Figures

- **Usable stock:** status available, not past expiry, and not held by a reservation (one definition, `lib/inventory.ts`).
- **Fulfilment rate:** delivered ÷ (delivered + released). Reservations still in progress are excluded.

## Architecture

```
Browser ── Next.js 16 (App Router, TypeScript) on Vercel, region sin1
             ├─ app/(app)/…     pages (role-checked on the server)
             ├─ app/api/…       JSON API (auth, validation, uniform errors)
             └─ lib/            rules · compat · requests (transactions) · auth
                    │ Prisma 6
                    ▼
              PostgreSQL (Neon, Singapore)
```

Validation uses the same Zod schemas on client and server. Constraints Prisma cannot express (partial unique index, `CHECK`s) are hand-written in the migrations.

## Run it locally

Requires Node 22+ and a PostgreSQL database (Neon free tier works).

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, DIRECT_URL, SESSION_SECRET, SEED_PASSWORD
npm run db:deploy         # apply migrations
npm run seed              # demo accounts and stock (prints the account emails)
npm run dev               # http://localhost:3000
```

On npm 11+, approve the install scripts if asked: `npm approve-scripts @prisma/client @prisma/engines prisma esbuild`.

## Tests

| Command | What it checks |
|---|---|
| `npm test` | Unit tests: compatibility cells, engine (including 500 randomised safety cases), states, validation, access rules, every API route is guarded |
| `npm run verify:db` | The database itself rejects double reservations and invalid rows |
| `npm run smoke:auth` | Login, roles and isolation against a running app |
| `npm run smoke:api` | Inventory, filters, dashboard, audit and reset (ends with a demo reset) |
| `npm run smoke:ui` | Drives a real browser through the main workflows, phone layout and console errors |
| `npm run race` | Parallel race, idempotency and cancel-vs-deliver tests (`BASE_URL`, `ITERATIONS`) |

The smoke and race tests use the database in `.env`.

## Known limitations

- The login rate limiter lives in each server instance's memory, so on serverless it slows guessing but is not a global limit. A shared store would fix that.
- Distances are straight-line, and courier time is an estimate. There is no routing or traffic data.
- No crossmatching, antibody screening, irradiation or other clinical requirements.
- Platelet compatibility is simplified.
- Delivery is attested by the blood bank. There is no hospital-side receipt step.
- Screens refresh by polling every 15 seconds; there is no live push.
- Request limits: 5 active and 30 per hour per hospital, 20 units per request.
- The free database sleeps when idle, so the first request after a pause can take a second or two.
