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
- `src/app.js`: Express factory, routes for users/create/list/claim/cancel/early return, structured JSON error handling. Exposes DB via `app.locals.db`. `createApp(dbPath, { now })` supports an injected clock for tests.
- `src/db.js`: SQLite users/absences/assignments/certifications, FK/row/JSON constraints, indexes, 1-second busy timeout. Five original users; no fabricated credentials. Explicit path → `DB_PATH` → `school.db` fallback.
- `src/coverage.js`: immediate write transactions, coherent batched read transactions, merge closure, linear gaps, lifecycle changes, response serialization.
- `src/validation.js`, `src/errors.js`: strict IDs/bodies/calendar timestamps, millisecond truncation, and business errors.
- `public/index.html`, `public/app.js`: functional build-free vanilla UI: directory/credentials, teacher form, assignments/gaps, explicit-range claims, lifecycle actions, timezone previews, preserved drafts, and pending/refresh recovery.
- Tests: API (74), gap (3), concurrency (9), frontend DOM/API (50): 136 total. Worker helper exercises independent processes/file-backed connections. JSDOM is test-only; no dependencies added for the merge-feedback fix.
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
- Risk-review decisions: every claim requires explicit start/end; reject ended requested windows; show timezone; prevent duplicate clicks and recover unknown network outcomes. User requested cancellation and teacher early return, prioritizing concurrency and rollback. Subsequent approval settled lightweight informational certifications and separate absence windows for breaks; full audits/security/privacy features remain deferred, not basic safe validation/rendering.
- Architecture committed as `512f9ab`; backend committed as `2e19f21`. Frontend and 24 new DOM/API tests are complete. Final contract is in `ARCHITECTURE.md`; guided user review in `DEMO.md`.
- Original frontend milestone: `fa00773`. User-requested refinement now removes visible/input milliseconds, uses 15-minute slots starting at midnight with blank dates, and enables whole-second editing by double-click or accessible button. Claims explicitly choose a gap before any bounds fill. Partial/complete drafts and original unchanged API/DST instants are preserved. Backend contract is unchanged; docs and walkthrough reflect the new controls.
- Quarter-hour controls committed as `d21495c`. Latest user refinement adds AM/PM throughout visible times; exact editing uses 12-hour hh:mm:ss plus an explicit period selector. Midnight is 12:00 AM; noon 12:00 PM. Canonical/API times are unchanged. Invalid or incomplete exact text/PM drafts are preserved rather than coerced to midnight. Docs/walkthrough are updated.
- AM/PM committed as `0770435`. Investigated the user's November merge report: actual #3/#4 are adjacent, #3 is covered, and chronological order explains #4 first. Reproduced misleading "Merged" on an unchanged duplicate submission in memory; historical browser sequence is not provable. Added explicit operation/removed-ID create metadata, accurate outcome messages, and a sorting explanation. User data was only read, never written; scheduling rules were not relaxed.

## Validation

- Latest normal and shuffled full runs both pass **136 tests** (50 frontend). Exact-November Chromium regression passes creation/no-op feedback, chronological #4/#3 order, protected coverage/rejection, and real consolidation IDs. Full existing Chromium smoke and CRLF-aware whitespace checks also pass. The user's saved database was never written by diagnostic/test actions.
- All three Mermaid diagrams passed syntax validation (tools only in `/tmp/opencode/aps-mermaid-11XweJ`). Chromium smoke passed desktop/mobile workflows, lifecycle actions, two-page conflicts, committed-response loss, and New York DST, with no uncaught page errors. Isolated browser tools/script/screenshots are in `/tmp/opencode/aps-browser-UGqW6a`; they are not project dependencies. Inspect `AI_LOG.md` for the command and evidence.
- Use `git -c core.whitespace=cr-at-eol diff --check`: npm preserved the original lockfile's CRLF endings, which otherwise appear as trailing whitespace. No broad lockfile reformat was done.
- Audit: zero production findings (`npm audit --omit=dev`), six existing Vitest/Vite dev-tool findings including critical. No force upgrades. Do not expose development/test servers or run untrusted tests; a toolchain upgrade needs separate review.
- Dependencies are already installed.
- Git is initialized on `main`; use `git log` and `git status` to verify the current commit history and working tree. No remote has been configured by this session.
- Verified ignore rules with `git check-ignore` for dependencies, database/sidecar paths, and `.env`. The initial staged whitespace check flags inherited CRLF/trailing whitespace in starter files; preserve that baseline rather than reformat unrelated files during Git setup.

## Approved business rules and contracts

- For the same teacher, merge overlapping open absences into one combined window. If any affected absence is claimed, reject the entire request with `409` and leave all records/assignments unchanged.
- With split coverage, any assignment (even partial coverage) protects an absence from merging.
- Perform merge discovery and writes atomically with respect to claims; a merge must not silently expand an accepted substitute shift. Do not merge records belonging to different teachers.
- Allow back-to-back substitute shifts and keep adjacent teacher absences separate (half-open intervals).
- HTTP codes: `201` new absence, `200` merge/claim, `400` invalid input, `403` wrong owner, `404` missing resource, `409` conflicts/ended windows, `413` oversized body, `503` lock contention. Absence response schemas are implemented in `src/coverage.js`; JSON errors are `{ error: { code, message } }`.
- Layered enforcement approved in principle; use constraints, backend validation, and transactional conflict checks. Do not equate integrity checks with authentication/authorization.
- Separate `assignments` table with actual split coverage of one absence by multiple substitutes. Each assignment has its own contained start/end window; do not add a unique constraint on `absence_id` or `substitute_id`.
- Approved timestamp contract: ISO with explicit timezone in the API, integer UTC Unix milliseconds in SQLite, canonical ISO responses. Seconds/Julian were considered, but milliseconds chosen for JavaScript convenience.
- Preserve distinct reasons in merges. No history/counter feature has been approved; counts, if added, should be derived and count merged windows rather than submissions.
- Preserve the lowest existing absence ID during merges. Structural integrity boundaries are approved: SQL row/reference constraints plus transactional API cross-row checks, without promising authentication or arbitrary-write protection.
- Every claim must include explicit start/end; no default whole-current-absence behavior. Reject already-ended absence/requested windows; allow an elapsed start when the requested end remains future. Use an injectable server clock in tests.
- Display timezone clearly; pending controls and refresh-based network recovery are required. Focus concurrency testing on all write paths and coherent board reads, not just same-absence claims.
- Cancellation and early return are implemented: future cancellation deletes, ongoing cancellation retains elapsed work, ended cancellation returns `409`. Early return preserves prior assignments, trims crossing ones, removes later ones, and shortens the absence atomically. Ordinary merges cannot modify covered absences.
- Certifications are optional informational metadata returned by `/api/users`; no eligibility enforcement, credential-management API, or invented seeds.

## Implementation defaults and deferred scope

- Open with no assignments; Partially Covered with gaps; Claimed only when fully covered. Reject same-absence overlaps even between different substitutes and substitute overlaps globally. Return assignments and remaining gaps.
- Claim body requires both times. Invalid/out-of-bounds windows return `400`; conflicts/expiry return `409`. In-progress windows are allowed if their end is future; historical absence creation is allowed. Do not silently change requested ranges.
- Reasons: JSON array, trim whitespace, exact deduplication, 2,000-character per-reason limit and 32 KiB aggregate limit; reject excess without dropping data.
- Revised precision policy following user feedback: validate full ISO input, accept extra fractional digits, truncate to milliseconds, return normalized values, then validate positive duration, containment, and conflicts. Reject intervals collapsing to zero duration; do not claim truncation preserves sub-millisecond information.
- Overlap rule: `existing.start < new.end && existing.end > new.start`.
- Immediate SQLite transaction around both interval checks and assignment insert. The original guarded-update-on-null design is superseded by the assignments table.
- SQL constraints protect references and valid windows; API validates actor roles. Cross-row overlap/role triggers are an optional stronger alternative, not implemented.
- No authentication: selected IDs simulate actors. Role validation and ownership matching do not prevent impersonation. Wrong owner returns `403`; lock contention returns `503` plus `Retry-After`; malformed JSON/oversize bodies get structured `400`/`413` errors.
- Ended claims are prohibited; no general ban on historical absence creation. Preserve distinct reasons, but do not claim to preserve every original submission or its time window.
- Early return: omitted cutoff means server now; explicit cutoff cannot backdate or extend, and cannot be at/before absence start. An explicit retry matching the current end is a no-op success after ownership validation. Already-ended absence changes return `409`.
- Breaks use separate absence windows; no inferred lunch period. Whole-absence cancellation before it starts, credential eligibility, travel buffers, availability/workload engines, full audit, authentication/privacy features remain deferred.

## Current milestone and next steps

- Current change set: `fix: report absence merge outcomes accurately`; check Git log/status for the resulting commit. All normal/shuffled tests, both browser scripts, and whitespace validation pass. User's `school.db` is real demo work: do not alter/reset/delete it. Reload the page to load new JS; restart the API if using a non-watching server. Legacy response shapes get neutral Saved wording rather than inferred merges.

- Previous AM/PM milestone: `0770435` (`feat: add explicit AM/PM time selection`). No dependency upgrades or submission cleanup are authorized.

- Previous picker milestone: `d21495c` (`feat: simplify date and time selection`). Blank optional early-return controls still mean server now; an edited time requires a date, so incomplete input cannot accidentally trigger it.

1. Architecture committed before application code as `512f9ab` (`docs: finalize reviewed scheduling architecture`). Baseline is `99650d2`.
2. Backend and frontend are complete. This verified change set is the UI milestone (`feat: connect coverage portal frontend`); check Git log/status for its resulting commit. All final test/browser/diagram checks pass. Documents are current and `DEMO.md` provides a user walkthrough.
3. Ask the user to review the running demo and final deliverables. No additional scope or force dependency upgrades without approval. Browser timezone is explicit; manual repeated times choose the earlier occurrence, while unchanged prefilled gap instants retain their exact offset.
4. Submission cleanup/packaging still requires user confirmation. Do not delete dependencies/data or zip the project yet; preserve hidden `.git` and milestone history when approved.

## Important correctness reminders

- A conditional update alone does not prevent the same substitute claiming two different overlapping shifts.
- Never compare unnormalized mixed-offset timestamp strings.
- Foreign keys to `users` do not validate teacher/substitute roles.
- Parallel requests on one synchronous in-memory connection do not establish multi-connection concurrency safety.
- Render free-text data safely; close test databases during cleanup.
- Document actual design corrections and observed bugs, not invented collaboration history.
