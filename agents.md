# Agent Handoff: APS Take-Home

## Working agreement

- The user wants collaborative planning and implementation, with room to discuss alternatives before choosing them.
- After every change set, update this `agents.md` file with what changed, checks performed, decisions, and next steps. Keep it truthful and current rather than creating duplicate context files.
- Do not treat proposed design choices as user-approved decisions.
- Keep the existing stack and style unless there is a concrete agreed reason to change them.
- Do not delete dependencies, database files, or other work until submission cleanup is explicitly approved.

## Task and required deliverables

Read `README.md` for the source specification. Build teacher absence creation, an open/claimed coverage board, and substitute claiming with backend role/time validation, no double claims, and no overlapping assignments for the same substitute.

Required deliverables:
1. `ARCHITECTURE.md`: reviewed Mermaid schema/flow and 2–3 genuine design corrections, before application code.
2. `src/db.js` and `src/app.js`: schema and create/list/claim API.
3. `public/index.html`: minimal functional UI; CSS polish is explicitly not a priority.
4. `tests/api.test.js` and `AI_LOG.md`: happy-path/edge-case tests and honest collaboration evidence.

README also requires milestone Git commits and final packaging including `.git`, excluding dependencies and generated databases.

## Architecture map

- `src/server.js`: port selection and app listener.
- `src/app.js`: Express factory, JSON/static middleware, `/api/users`, and absence endpoint TODOs. Exposes the DB via `app.locals.db`.
- `src/db.js`: `better-sqlite3` factory; foreign keys enabled; five seeded users; no absence schema yet. Explicit path → `DB_PATH` → `school.db` fallback.
- `public/index.html`: single-file vanilla UI. Only staff-directory loading works.
- `tests/api.test.js`: Vitest/Supertest with a fresh `:memory:` app per test; only the seed test exists.
- `package.json`: `npm start`, `npm run dev`, `npm test`; no frontend build.

## Completed work

- Read all project source, the existing test, `README.md`, `ARCHITECTURE.md`, and `AI_LOG.md`.
- Added `ROADMAP.md` with architecture findings, implementation alternatives, proposed API, milestones, and verification checklist.
- Created this handoff file as requested.
- With user approval, initialized Git on `main` and added `.gitignore` for dependencies, generated SQLite databases/sidecars, local environment files, and logs. This setup change set establishes the starter/planning baseline commit before architecture work.
- Expanded `ARCHITECTURE.md` with a proposed Mermaid ERD, claim transaction sequence, endpoint summary, enforcement boundaries, and open review decisions. The user requested the proposal in that file; this does not constitute approval of all design choices.
- Recorded the user's approved teacher-overlap merge policy in `ARCHITECTURE.md` and `ROADMAP.md`, added a Mermaid create/merge flow, and documented two genuine review corrections: combine open windows and protect claimed coverage.
- Recorded approval of back-to-back substitute shifts, separate adjacent teacher absences, HTTP response codes, and layered enforcement.
- Latest user decision explicitly requests actual split coverage now, not just future extensibility. Revised `ARCHITECTURE.md` ERD/claim flow and `ROADMAP.md` for timed assignments, interval conflicts, coverage gaps, and partial status. User chose the recommended ISO contract with JavaScript-friendly UTC milliseconds and preservation of distinct merge reasons.
- Began `AI_LOG.md` with actual tooling, key prompts, baseline verification, and design corrections. No transcript export, implemented feature, or runtime bug is claimed.
- Latest review: user approved lowest-ID merge survival and structural integrity boundaries, questioned rejection of finer timestamp precision, and reported a Mermaid parse error. Reproduced that exact parse error with an isolated Mermaid 11 package under `/tmp/opencode/aps-mermaid-11XweJ`; replaced the final claim note's semicolon with "and". Updated precision policy to accept validated finer fractions and truncate to milliseconds, with normalized-window validation.
- Added `DESIGN_REVIEW.md` after the user requested a broader risk/use-case review. It records prospective stale-intent, concurrent-write, gap/merge, timezone/precision, retry, input/storage risks, plus product and production limitations. These findings are not implemented bugs or automatically approved scope additions.
- Latest decisions: every claim requires explicit start/end; reject ended requested windows; show timezone; prevent duplicate clicks and recover unknown network outcomes. User now requests cancellation and teacher early return, prioritizing concurrency and rollback. Documented proposed lifecycle mechanics, coherent read snapshots, and gap/merge complexity. Certification/break handling remain under discussion; full audits/security/privacy features are deferred, not basic safe validation/rendering.
- Final user approval: proceed with linear gap scans, simple indexed overlap lookup, cancellation, lightweight certification metadata, and concurrency recommendations. Finalized `ARCHITECTURE.md` with four-table ERD and lifecycle/operational defaults. Architecture review is complete; application implementation is next.

## Validation

- Baseline `npm test`: passed, 1 test in 1 test file.
- Documentation-only additions have not changed runtime behavior.
- Architecture draft: `git diff --check` passed. After reproducing/fixing the user's Mermaid error, all three diagrams pass Mermaid 11 `parse()` validation, using JSDOM for flowchart sanitization. This is syntax validation, not visual rendering. Packages were installed only under `/tmp/opencode/aps-mermaid-11XweJ`; project dependencies are unchanged. The draft is uncommitted pending user review; baseline commit is `99650d2`.
- Dependencies are already installed.
- Git is initialized on `main`; use `git log` and `git status` to verify the current commit history and working tree. No remote has been configured by this session.
- Verified ignore rules with `git check-ignore` for dependencies, database/sidecar paths, and `.env`. The initial staged whitespace check flags inherited CRLF/trailing whitespace in starter files; preserve that baseline rather than reformat unrelated files during Git setup.

## Approved business rules and contracts

- For the same teacher, merge overlapping open absences into one combined window. If any affected absence is claimed, reject the entire request with `409` and leave all records/assignments unchanged.
- With split coverage, any assignment (even partial coverage) protects an absence from merging.
- Perform merge discovery and writes atomically with respect to claims; a merge must not silently expand an accepted substitute shift. Do not merge records belonging to different teachers.
- Allow back-to-back substitute shifts and keep adjacent teacher absences separate (half-open intervals).
- HTTP codes approved: `201` new absence, `200` merge/claim, `400` invalid input, `404` missing absence, `409` conflicts. Exact response schemas remain open.
- Layered enforcement approved in principle; use constraints, backend validation, and transactional conflict checks. Do not equate integrity checks with authentication/authorization.
- Separate `assignments` table with actual split coverage of one absence by multiple substitutes. Each assignment has its own contained start/end window; do not add a unique constraint on `absence_id` or `substitute_id`.
- Approved timestamp contract: ISO with explicit timezone in the API, integer UTC Unix milliseconds in SQLite, canonical ISO responses. Seconds/Julian were considered, but milliseconds chosen for JavaScript convenience.
- Preserve distinct reasons in merges. No history/counter feature has been approved; counts, if added, should be derived and count merged windows rather than submissions.
- Preserve the lowest existing absence ID during merges. Structural integrity boundaries are approved: SQL row/reference constraints plus transactional API cross-row checks, without promising authentication or arbitrary-write protection.
- Every claim must include explicit start/end; no default whole-current-absence behavior. Reject already-ended absence/requested windows. Exact in-progress start policy remains open; use an injectable server clock in tests.
- Display timezone clearly; pending controls and refresh-based network recovery are required. Focus concurrency testing on all write paths and coherent board reads, not just same-absence claims.
- User requested substitute cancellation reopening coverage and teacher early return shortening/releasing jobs. Proposed exact mechanics are not yet approved; ordinary merges still cannot change accepted coverage.

## Proposed choices, awaiting discussion

- New split mechanics documented for review: Open with no assignments; Partially Covered with gaps; Claimed only when fully covered. Reject overlaps within an absence even between different substitutes, as well as substitute overlaps globally. Return assignments and remaining gaps to the UI.
- Claim body requires both times. Invalid/out-of-bounds windows return `400`; conflicting intervals return `409`. Expiry `409` is proposed. Do not silently shorten/expand requested ranges.
- Proposed reason representation: JSON array of distinct trimmed strings with exact deduplication.
- Revised precision policy following user feedback: validate full ISO input, accept extra fractional digits, truncate to milliseconds, return normalized values, then validate positive duration, containment, and conflicts. Reject intervals collapsing to zero duration; do not claim truncation preserves sub-millisecond information.
- Overlap rule: `existing.start < new.end && existing.end > new.start`.
- Immediate SQLite transaction around both interval checks and assignment insert. The original guarded-update-on-null design is superseded by the assignments table.
- SQL constraints protect references and valid windows; API validates actor roles. Cross-row overlap/role triggers are an optional stronger alternative, not implemented.
- No authentication beyond selected user IDs in this exercise.
- Ended claims are prohibited; no general ban on historical absence creation. Preserve distinct reasons, but do not claim to preserve every original submission or its time window.
- Proposed cancellation: delete a future assignment, or truncate an ongoing one to retain elapsed coverage and reopen only the remaining time. Proposed teacher early return: shorten absence, leave prior assignments, trim crossing ones, delete later ones, all atomically. Cutoffs at/before absence start and ended cancellation policies need discussion.
- Break recommendation: separate required-coverage absence windows around breaks, no inferred lunch period. Certification can use modest optional metadata, but display versus enforced eligibility/expiry is undecided. Travel buffers, availability/workload engines, full audit, authentication/privacy features remain deferred.

## Current milestone and next steps

1. Commit the reviewed architecture before application code. Baseline commit is `99650d2`; check Git history for the resulting architecture milestone.
2. Implement schema/API and integration tests. Certs are display-only; no invented credentials. Cancellation retains elapsed coverage, early return shortens/releases jobs atomically, and every claim supplies times. See the final implementation contract in `ARCHITECTURE.md` for clock, ownership, size/error, and cutoff defaults; it supersedes earlier pending-choice notes above.
3. Validate real separate-connection concurrency, mid-operation rollback, consistent read snapshots, normalized times, and gaps. Update this file and `AI_LOG.md` at the code milestone.
4. Then minimal UI, verification, and final deliverables. Do not silently add deferred production features.

## Important correctness reminders

- A conditional update alone does not prevent the same substitute claiming two different overlapping shifts.
- Never compare unnormalized mixed-offset timestamp strings.
- Foreign keys to `users` do not validate teacher/substitute roles.
- Parallel requests on one synchronous in-memory connection do not establish multi-connection concurrency safety.
- Render free-text data safely; close test databases during cleanup.
- Document actual design corrections and observed bugs, not invented collaboration history.
