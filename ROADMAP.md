# APS Take-Home: Implementation Roadmap

## Goal and scope

Build a reliable teacher absence and substitute coverage workflow using the existing stack. The required outcome is:
- Teachers can create an absence with a time window and optional reason/subject.
- The board lists every absence, its teacher, time window, derived coverage status, assignments, and remaining gaps.
- Substitutes can cover whole absences or selected uncovered portions, but cannot double-book themselves or double-cover the same absence window. Split coverage is a user-approved extension; status can be Open, Partially Covered, or Claimed (fully covered).
- The backend validates input and enforces the rules independently of the UI.
- Architecture diagrams, automated tests, and an honest AI collaboration log accompany the implementation.

The README suggests a roughly 60-minute exercise. Favor correctness and a small complete feature over extra features or a new framework. Recommendations below are proposals unless explicitly marked approved.

## Current architecture and baseline

| File | Current responsibility |
| --- | --- |
| `src/server.js` | Starts Express on `PORT` or port 3000. |
| `src/app.js` | Creates the app/database, serves `public/`, exposes user/create/list/claim/cancel/early-return routes, and provides structured JSON errors. |
| `src/db.js` | SQLite schema for users, absences, assignments, and certifications; foreign keys, row checks, indexes, bounded busy timeout, and five original seeded users. Supports explicit path, `DB_PATH`, or `school.db`. |
| `src/coverage.js` | Transactional scheduling service, snapshot reads, merge closure, linear gap calculation, lifecycle operations, and derived response data. |
| `src/validation.js`, `src/errors.js` | Strict ISO/ID/body validation, millisecond normalization, and business errors. |
| `public/index.html`, `public/app.js` | Build-free HTML/vanilla JS; directory/credentials, creation, coverage/gaps, explicit claims, lifecycle controls, timezone previews, pending state, and refresh recovery. |
| `tests/api.test.js`, `tests/coverage.test.js`, `tests/concurrency.test.js`, `tests/frontend.test.js` | 108 tests covering API, gaps, rollback, persistence, separate-process concurrency, and DOM interactions against the API. Temporary data/connections are cleaned up. |
| `ARCHITECTURE.md` | Reviewed ERD, create/merge and claim flows, three genuine design corrections, finalized contracts, and implementation checkpoint. |
| `AI_LOG.md` | Real planning prompts, review corrections, implementation findings, and test evidence. |

Request flow: browser → Express routes → synchronous `better-sqlite3` queries → SQLite → JSON response → browser rendering. No frontend build, authentication, ORM, or external service is present or needed for the stated task.

Original baseline: one seeded-user test passed. Current verification: 108 tests pass. JSDOM was added only as a test dependency; no runtime dependencies/frameworks were added. Isolated Chromium checks cover real browser workflows and desktop/mobile layout. Git is on `main`; `.gitignore` excludes runtime data/dependencies. Architecture milestone: `512f9ab`; backend milestone: `2e19f21`.

## Design choices to discuss

### 1. Coverage data model

**Approved:** separate `absences` and `assignments` tables supporting actual split coverage now, not merely future extensibility.
- Absences store teacher, start/end, and distinct reasons. Assignments store absence, substitute, and their own start/end.
- Do not make assignment `absence_id` or `substitute_id` unique. Enforce non-overlapping windows instead.
- Each assignment must fit entirely inside its absence. Reject double coverage of the same absence, even by different substitutes, and overlapping assignments for the same substitute across all absences.
- Derive Open / Partially Covered / Claimed and remaining gaps from ordered assignment intervals.
- Foreign keys, required fields, and positive-duration checks protect row integrity. Role and cross-row checks belong in the transactional API unless additional database triggers are chosen.
- Original single-table assignment and one-assignment-per-absence proposals were rejected in favor of real split coverage.

### 2. Time representation and interval semantics

**Approved:** accept strictly validated ISO timestamps containing `Z` or a numeric UTC offset; normalize to integer UTC Unix milliseconds in SQLite; return canonical ISO strings in the API. The browser converts `datetime-local` inputs to ISO before sending. Milliseconds were selected for JavaScript convenience; seconds would also have sufficient scheduling precision. Following user review, accept higher fractional precision and explicitly truncate to milliseconds, rather than reject valid timestamps solely for excess precision.
- Validate actual calendar dates, not just a permissive `Date.parse` result, and require end > start.
- Validate full input before truncation; check duration/containment/conflicts after normalization. Reject a positive sub-millisecond window if both endpoints collapse to the same millisecond. Returning normalized values makes the loss of sub-millisecond precision explicit; this is not lossless archival storage.
- **Approved:** treat windows as half-open: `[start, end)`. Back-to-back substitute shifts are allowed, and adjacent teacher absences remain separate.
- Conflict condition: `existing.start_time < requested.end_time AND existing.end_time > requested.start_time`.

**Alternative:** store canonical UTC ISO strings. Readable in SQLite and comparable if every value is normalized identically. Never compare raw mixed-offset timestamp strings.

Julian-day storage is another valid SQLite option, but offers no scheduling advantage here. ISO input/output and numeric storage are complementary choices, not competing formats for the same layer.

Timezone-less API input is rejected; the frontend converts local inputs and displays timezone/offsets. Unchanged prefilled gaps retain exact ISO instants across DST folds, and invalid local DST times are rejected. Ended windows cannot be claimed; in-progress windows with a future end are allowed. Historical absence creation remains allowed.

### 3. Atomic claiming

**Recommended mechanics for the approved assignment model:** perform absence/user lookup, role checks, assignment containment, same-absence overlap, and substitute schedule overlap inside a short SQLite immediate transaction, then insert the assignment.
- Acquire the write reservation before reading conflicts, so another writer cannot insert a conflicting assignment between the check and update.
- A unique absence constraint is no longer appropriate. Both interval checks must remain inside the transaction; adjacent split claims can both succeed.
- Handle lock contention deliberately; avoid exposing raw SQLite errors as API responses.

**Alternative:** database triggers can enforce overlap/role constraints for all write paths. They provide stronger database-wide protection but add SQL complexity. A single application claim path plus an immediate transaction is the proposed take-home scope.

### 4. Extra business rules and feature boundaries

**Approved by the user:** merge overlapping open absences for the same teacher into one combined window, preserve distinct reasons, and retain the lowest existing ID. Reject the entire request with `409` if any affected absence has any assignment, including partial coverage; never silently extend a substitute's commitment. Overlap checks and merge writes run in one immediate transaction, serialized with claims. Different teachers' absences remain separate. Proposed reason representation: JSON array with exact deduplication after trimming.

**Approved extensions:** substitute cancellation that reopens remaining coverage, explicit teacher early return that shortens/releases assignments, and informational certification metadata. Final mechanics and operational defaults are in `ARCHITECTURE.md`. These lifecycle operations are distinct from ordinary merging, which cannot change accepted coverage.

Keep authentication, full audit history, notifications, pagination, travel buffers, availability/workload rules, and UI redesign deferred. Certifications are informational, without eligibility enforcement or invented seeded credentials. Breaks use separate absence windows rather than inferred lunch periods. Selecting a user ID simulates an actor; role validation is not authentication. The user deprioritized reason-privacy features, not basic safe input/output handling.

**Approved:** database constraints, backend validation, transactional checks, parameterized SQL, and safe DOM text rendering are implemented. Cross-row enforcement is in the API, without triggers; these controls do not substitute for authentication/authorization.

## Proposed API contract

Keep the existing `/api/users` endpoint.

| Endpoint | Input / output | Main outcomes |
| --- | --- | --- |
| `POST /api/absences` | `{ teacher_id, start_time, end_time, reason? }`; returns resulting absence | Approved: `201` created / `200` merged; `400` invalid input; `409` for same-teacher overlap involving claimed coverage |
| `GET /api/absences` | Array with teacher name, reasons, timestamps, derived status, assignments/substitute names, and uncovered windows | `200`, including `[]` when empty |
| `POST /api/absences/:id/claim` | `{ substitute_id, start_time, end_time }`, both times required; returns updated absence with assignments | `200`; `400` invalid input/role/out-of-bounds window; `404` missing absence; `409` overlapping coverage, substitute schedule, or expired window |

Responses are implemented with joined display data, `Open` / `Partially Covered` / `Claimed` status, assignments, and uncovered windows. JSON errors are `{ error: { code, message } }`. Additional lifecycle and operational responses are documented in `ARCHITECTURE.md`.

**Approved:** require explicit start/end on every claim; remove the whole-current-absence shortcut. Never silently claim multiple gaps or trim/expand requested windows. The UI allows claims on Open and Partially Covered records with non-expired requested windows.

Concurrency/recovery recommendation: all writes use short immediate transactions with all-or-nothing rollback; construct board data with batched reads in one consistent snapshot. Disable pending controls, recover ambiguous network outcomes by refreshing, and do not blindly retry writes. Gap scanning is linear in that absence's ordered assignments; indexed teacher-overlap lookup and its performance limits are documented in `DESIGN_REVIEW.md`.

## Implementation milestones

### 0. Agree on scope and preserve progress
- Review the choices above together; record actual user decisions and corrections.
- Git initialized on `main` with user approval; `.gitignore` added. Record the starter and planning baseline before application implementation, then commit subsequent logical milestones.
- Update `agents.md` after every change set so the next session can resume accurately.

### 1. Architecture before application code
- Fill `ARCHITECTURE.md` with the reviewed schema ERD and claim sequence diagram, including transaction boundaries and conflict responses.
- Record 2–3 genuine refinements to the initial proposal; do not invent user feedback or claim untested guarantees.
- Begin `AI_LOG.md` with tooling and real planning prompts/decisions.
- Suggested commit: `1. Architecture plan`.

### 2. Database, API, and tests together
- Add absence and timed-assignment schemas and lookup indexes to `createDb()` without disturbing user seeds.
- Add focused validation and the create/list/claim endpoints, following the current CommonJS style.
- Implement atomic conflict checks and consistent JSON errors.
- Add reviewed cancellation/early-return operations with the same transaction boundaries; reject ended claim windows using an injectable server clock.
- Grow integration tests alongside each behavior; close database connections in test cleanup.
- Suggested commit: `2. DB & API`.

### 3. Minimal usable frontend
- Populate a teacher selector and absence form with start/end inputs and optional reason.
- Populate a substitute selector and render all statuses, each assignment with its substitute/time range, distinct reasons, and uncovered gaps.
- Allow selection of a continuous uncovered time range on Open or Partially Covered absences; refresh after successful writes. Keep full-absence claiming easy for completely open shifts.
- Show server/network errors, pending/disabled controls, and empty states. Refresh after a stale-board claim conflict.
- Display timezone/offset clearly and provide reviewed cancellation/early-return controls. Refresh after successful writes and stale `404`/`409` responses; recover unknown network outcomes from the current board.
- Render user-controlled content safely using DOM text APIs, not unsanitized HTML interpolation.
- Keep the existing stylesheet; no frontend framework or build tooling.

### 4. Verification and deliverable review
- Run the full automated suite and manually exercise the browser workflow.
- Ensure diagrams match the final code and log a real caught edge case in `AI_LOG.md`.
- Suggested commit: `3. UI & Tests` (or split into smaller logical commits).
- Confirm all required files are complete and Git history is present.
- At submission time only, and with user confirmation, remove `node_modules/` and generated `school.db` plus any SQLite sidecar files, then package the project including hidden `.git`.

## Verification checklist

Required behavior:
- Seeded users still load, including role filtering.
- Create a valid absence, including one without a reason.
- List empty, open, and claimed results with correct names and deterministic ordering.
- Claim successfully as a substitute; persist and display the assignment.
- Split one absence between multiple substitutes and verify Open → Partially Covered → Claimed as the final gap is filled.
- Verify separated assignments leave an internal gap; never mark full coverage just because assignments exist.
- Reject out-of-bounds assignment windows and overlaps within one absence even with different substitutes.
- Allow adjacent assignments within one absence, including different substitutes, and the same substitute returning for another non-overlapping portion.
- Reject missing/invalid IDs, unknown users, and users with the wrong role.
- Reject missing, malformed, impossible, equal, or reversed times; test timezone normalization.
- Accept valid fractions longer than milliseconds, verify truncation and canonical output, and reject malformed inputs or intervals that collapse to zero duration after normalization. Exercise conflict checks at normalized boundaries.
- Reject an already claimed absence without changing its assignment.
- Reject overlapping shifts for the same substitute: partial overlap, containment, and identical windows.
- Allow back-to-back shifts and overlapping windows covered by different substitutes.
- Rejections leave database state unchanged.
- Require both claim times, reject ended requested windows, and use a controlled clock for deterministic boundary tests.
- Test multiple leading/internal/trailing coverage gaps and stale explicit claims after an ID-preserving merge.
- After lifecycle semantics are agreed: test cancellation reopening only released time and early return leaving/truncating/removing assignments at the cutoff. Exercise lifecycle-versus-claim races and failures midway through multi-row operations.
- Verify board responses use a consistent absence/assignment snapshot during concurrent writes; UI double-click prevention is not a substitute for backend conflict checks.

Approved teacher-merge behavior:
- Merge partially overlapping, contained, identical, and multiple connected open windows for the same teacher.
- Preserve reasons and apply the agreed record-ID policy.
- Keep different teachers' records separate; keep merely adjacent windows separate under the approved interval policy.
- Reject any same-teacher overlap involving an absence with any assignment (including partial coverage), leaving all records and assignments unchanged, even when the request also overlaps open records.
- Verify merging and claiming cannot interleave into a silently extended assignment; stale merged-away IDs return `404`.

Additional reliability checks if time permits:
- Assert basic constraints through direct database writes.
- Exercise persistence by reopening a temporary file-backed database.
- Exercise separate database connections/processes for competing claims. Parallel Supertest requests against one synchronous in-memory connection test outcomes, but do not by themselves prove multi-connection race safety.
- Validate malformed JSON/body types and safe rendering of free-text reasons.

## Current next action

Architecture, backend, and frontend are implemented and tested; the verified UI change set is the third feature milestone. Next: the user's final walkthrough and deliverable review using `DEMO.md`. Note the six existing dev-tool audit findings (production-only audit is zero); do not force-upgrade without separate review. Submission cleanup/packaging remains gated on user approval.
