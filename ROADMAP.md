# APS Take-Home: Implementation Roadmap

## Goal and scope

Build a reliable teacher absence and substitute coverage workflow using the existing stack. The required outcome is:
- Teachers can create an absence with a time window and optional reason/subject.
- The board lists every absence, its teacher, time window, Open/Claimed status, and assigned substitute.
- Substitutes can claim open absences, but cannot double-book themselves or claim an already claimed absence.
- The backend validates input and enforces the rules independently of the UI.
- Architecture diagrams, automated tests, and an honest AI collaboration log accompany the implementation.

The README suggests a roughly 60-minute exercise. Favor correctness and a small complete feature over extra features or a new framework. Recommendations below are proposals for review, not approved implementation decisions.

## Current architecture and baseline

| File | Current responsibility |
| --- | --- |
| `src/server.js` | Starts Express on `PORT` or port 3000. |
| `src/app.js` | Creates the app and database, serves `public/`, exposes `GET /api/users` with optional role filtering. Absence endpoints are TODOs. |
| `src/db.js` | Opens SQLite, enables foreign keys, creates `users`, and seeds three teachers and two substitutes if the table is empty. Supports an explicit database path, `DB_PATH`, or a default `school.db`. |
| `public/index.html` | Inline CSS and JavaScript; displays seeded users. Absence form and coverage board are placeholders. |
| `tests/api.test.js` | Vitest + Supertest; creates an in-memory app for each test. One seeded-user test exists. |
| `ARCHITECTURE.md` | Required ERD, claim-flow, and design-review templates; not yet completed. |
| `AI_LOG.md` | Required AI tooling, prompts, and edge-case review template; not yet completed. |

Request flow: browser → Express routes → synchronous `better-sqlite3` queries → SQLite → JSON response → browser rendering. No frontend build, authentication, ORM, or external service is present or needed for the stated task.

Baseline: `npm test` passes (1 test). Dependencies are already installed. Git has been initialized on `main` with user approval; `.gitignore` excludes dependencies, generated SQLite databases/sidecars, local environment files, and logs.

## Design choices to discuss

### 1. Coverage data model

**Recommended:** one `absences` table with `id`, `teacher_id`, `start_time`, `end_time`, optional `reason`, and nullable `substitute_id`.
- A null substitute means Open; a non-null substitute means Claimed. Derive status rather than store a second value that can disagree.
- Foreign keys reference `users`; required fields and `CHECK (end_time > start_time)` protect row integrity.
- Foreign keys alone do not enforce teacher/substitute roles. Validate roles in the API; add triggers only if we decide direct database writes also need role enforcement.
- Suitable for the requirement of exactly one substitute per absence.

**Alternative:** separate `absences` and `assignments` tables, with a unique absence reference in assignments. Better for assignment history or reassignment, but adds joins and complexity without a current requirement.

### 2. Time representation and interval semantics

**Recommended:** accept strictly validated ISO timestamps containing `Z` or a numeric UTC offset; normalize to integer Unix milliseconds in SQLite; return canonical ISO strings in the API. The browser converts `datetime-local` inputs to ISO before sending.
- Validate actual calendar dates, not just a permissive `Date.parse` result, and require end > start.
- Treat windows as half-open: `[start, end)`. Back-to-back shifts are allowed.
- Conflict condition: `existing.start_time < requested.end_time AND existing.end_time > requested.start_time`.

**Alternative:** store canonical UTC ISO strings. Readable in SQLite and comparable if every value is normalized identically. Never compare raw mixed-offset timestamp strings.

Confirm how to interpret timezone-less input. The README allows an ISO timestamp or date/time; an explicit-offset API contract is a proposed way to remove ambiguity, not an already stated requirement. Do not add past-date restrictions unless agreed.

### 3. Atomic claiming

**Recommended:** perform existence, role, already-claimed, schedule-overlap, and assignment checks inside a short SQLite immediate transaction. Use a guarded update (`... WHERE substitute_id IS NULL`) and check the affected-row count.
- Acquire the write reservation before reading conflicts, so another writer cannot insert a conflicting assignment between the check and update.
- A guarded update alone prevents two claimants taking the same absence but does not prevent one substitute claiming two different overlapping absences.
- Handle lock contention deliberately; avoid exposing raw SQLite errors as API responses.

**Alternative:** database triggers can enforce overlap/role constraints for all write paths. They provide stronger database-wide protection but add SQL complexity. A single application claim path plus an immediate transaction is the proposed take-home scope.

### 4. Extra business rules and feature boundaries

Discuss whether to reject overlapping absences for the same teacher. It is sensible but not explicitly required; keep it optional until agreed.

Keep cancellation, unclaim/reassignment, authentication, notifications, pagination, and UI redesign out of the initial scope. Selecting a user ID simulates an actor; role validation is not real authentication.

## Proposed API contract

Keep the existing `/api/users` endpoint.

| Endpoint | Input / output | Main outcomes |
| --- | --- | --- |
| `POST /api/absences` | `{ teacher_id, start_time, end_time, reason? }`; returns created absence | `201`; `400` for invalid fields, unknown teacher, or wrong role |
| `GET /api/absences` | Array with teacher name, timestamps, derived status, and substitute ID/name if claimed | `200`, including `[]` when empty |
| `POST /api/absences/:id/claim` | `{ substitute_id }`; returns updated absence | `200`; `400` invalid ID/body/actor role; `404` missing absence; `409` already claimed or overlapping assignment |

Finalize exact response fields, status casing, validation order, and consistent JSON error shape before implementation. Return joined display data rather than requiring the browser to assemble relationships.

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
- Add the agreed absence schema to `createDb()` without disturbing existing user seeds.
- Add focused validation and the create/list/claim endpoints, following the current CommonJS style.
- Implement atomic conflict checks and consistent JSON errors.
- Grow integration tests alongside each behavior; close database connections in test cleanup.
- Suggested commit: `2. DB & API`.

### 3. Minimal usable frontend
- Populate a teacher selector and absence form with start/end inputs and optional reason.
- Populate a substitute selector and render all open/claimed absences with joined names.
- Show claim buttons only for open shifts; refresh the board after successful writes.
- Show server/network errors, pending/disabled controls, and empty states. Refresh after a stale-board claim conflict.
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
- Reject missing/invalid IDs, unknown users, and users with the wrong role.
- Reject missing, malformed, impossible, equal, or reversed times; test timezone normalization.
- Reject an already claimed absence without changing its assignment.
- Reject overlapping shifts for the same substitute: partial overlap, containment, and identical windows.
- Allow back-to-back shifts and overlapping windows covered by different substitutes.
- Rejections leave database state unchanged.

Additional reliability checks if time permits:
- Assert basic constraints through direct database writes.
- Exercise persistence by reopening a temporary file-backed database.
- Exercise separate database connections/processes for competing claims. Parallel Supertest requests against one synchronous in-memory connection test outcomes, but do not by themselves prove multi-connection race safety.
- Validate malformed JSON/body types and safe rendering of free-text reasons.

## Current next action

Review the recommended model, time policy, transaction approach, and optional teacher-overlap rule together. Then complete the architecture deliverable before writing application code.
