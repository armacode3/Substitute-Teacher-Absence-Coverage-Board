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
- No application code or existing deliverable templates have been modified.

## Validation

- Baseline `npm test`: passed, 1 test in 1 test file.
- Documentation-only additions have not changed runtime behavior.
- Dependencies are already installed.
- Git is initialized on `main`; use `git log` and `git status` to verify the current commit history and working tree. No remote has been configured by this session.
- Verified ignore rules with `git check-ignore` for dependencies, database/sidecar paths, and `.env`. The initial staged whitespace check flags inherited CRLF/trailing whitespace in starter files; preserve that baseline rather than reformat unrelated files during Git setup.

## Proposed choices, awaiting discussion

- One `absences` table with nullable `substitute_id`; derive status instead of duplicating state.
- Strict ISO-with-offset API timestamps, normalized integer UTC milliseconds in SQLite, canonical ISO strings in responses. Discuss timezone-less input explicitly because the spec permits date/time input.
- Half-open intervals: adjacency allowed; overlap is `existing.start < new.end && existing.end > new.start`.
- Immediate SQLite transaction around claim checks/write, plus guarded assignment update.
- SQL constraints protect references and valid windows; API validates actor roles. Cross-row overlap/role triggers are an optional stronger alternative, not implemented.
- No authentication beyond selected user IDs in this exercise.
- Teacher absence overlap policy remains open; do not silently add restrictions on past dates or overlapping teacher absences.

## Next steps

1. Next user-requested design step: collaborate on the Mermaid schema in `ARCHITECTURE.md`; see the proposed choices in `ROADMAP.md`.
2. Settle the schema/time/claim decisions with the user, then complete the flow diagram and genuine design-review corrections before application code; begin a factual `AI_LOG.md`.
3. Commit the reviewed architecture as its own milestone.
4. Implement schema/API with tests, then minimal UI, then verify and finalize deliverables.

## Important correctness reminders

- A conditional update alone does not prevent the same substitute claiming two different overlapping shifts.
- Never compare unnormalized mixed-offset timestamp strings.
- Foreign keys to `users` do not validate teacher/substitute roles.
- Parallel requests on one synchronous in-memory connection do not establish multi-connection concurrency safety.
- Render free-text data safely; close test databases during cleanup.
- Document actual design corrections and observed bugs, not invented collaboration history.
