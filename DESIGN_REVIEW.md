# Design Risk Review and Real-World Boundaries

## Status

This began as a prospective design review. The full feature is now implemented with 108 automated tests, including rollback, separate-process concurrency, and frontend DOM/API interactions. Isolated Chromium checks verified real workflows, stale conflicts, committed-response loss, mobile layout, and DST. The checklist is not a claim that every production use case is supported. Final contracts/defaults are in `ARCHITECTURE.md`; walkthrough in `DEMO.md`.

## High-priority correctness scenarios

### 1. Stale claim intent after a merge

Scenario: a substitute sees absence ID 1 as 09:00–12:00. Another request merges it into 09:00–15:00, preserving ID 1. The substitute sends an ID-only claim; resolving omitted times against the current row would assign hours they never saw.

Implemented protection: the UI sends explicit selected start/end timestamps and preserves edited drafts during actor changes/refreshes. A stale 09:00–12:00 request can cover only that range, leaving the remainder uncovered. Never silently expand the submitted window.

**Resolved:** the user requires explicit start/end timestamps on every claim; remove the optional-time shortcut. A version precondition remains a stronger alternative if any change to an absence should require renewed confirmation. Explicit times protect the time window, not changes to reasons or other future terms, and do not make every client's display permanently current.

Test: merge expands the surviving ID, then submit the previously displayed explicit range and verify that no extra hours are assigned. A merged-away ID returns `404`; the UI refreshes after `404` as well as `409`.

### 2. Simultaneous writes and complete rollback

Exercise all of these, not just two claims on the same absence:
- Different substitutes request overlapping portions of one absence: only one succeeds for the contested time.
- One substitute requests overlapping portions of different absences: only one succeeds for the contested time.
- Two requests claim adjacent portions: both may succeed.
- Merge versus claim: no accepted coverage is silently expanded or deleted.
- Failure after a survivor update but before merged-record deletion: the entire merge rolls back, including reasons.

Checks and writes must be inside the same immediate transaction. Separate-connection/process tests against one temporary database are needed for meaningful writer-contention coverage; concurrent requests through one synchronous in-memory connection are insufficient proof.

Begin the transaction before any mutation; commit only after all operations succeed, otherwise roll back. A rollback is not a backup or a preliminary operation performed before merging. The same discipline must apply to newly requested cancellation and early-return writes. Test cancel-versus-claim and early-return-versus-claim races, not only merges.

Implemented lock policy: a one-second busy timeout followed by retryable `503` with `Retry-After: 1`. Do not map every SQLite failure to `409` or expose raw errors. Separate-process tests verify no write on timeout and success after lock release.

### 3. Missing coverage hidden by status logic

For a 09:00–15:00 absence, assignments of 09:00–11:00 and 12:00–15:00 leave an 11:00–12:00 gap. Assignment existence, assignment count, or the minimum/maximum endpoints do not prove full coverage.

Derive gaps by scanning ordered intervals from the absence start through its end. Test leading, internal, and trailing gaps, exact adjacency, out-of-order inserted assignments, and assignments matching either/both boundaries. A range spanning an already covered middle section must be rejected, not silently split into gaps.

### Gap algorithm and complexity

For `k` ordered active assignments, maintain `cursor = absence.start`. For each assignment, emit `[cursor, assignment.start)` when its start is greater than the cursor, then advance the cursor to the greater of its current value and the assignment end. Emit the trailing gap if the final cursor is before the absence end. Containment and non-overlap validation still happen when writing assignments; a robust scan does not replace those invariants.

Example: absence 09:00–17:00, assignments 09:00–10:00, 11:00–12:00, 14:00–17:00. A single pass emits two gaps, 10:00–11:00 and 12:00–14:00.

- Gap computation: `O(k)` time; `O(g)` output storage for `g` gaps, at most `k + 1`. Returning `g` distinct gaps necessarily costs at least `O(g)`.
- `(absence_id, start_time)` supports fetching the assignments in order without a separate sort when the planner uses the index. Without ordered retrieval, sorting costs `O(k log k)`.
- Compute only the affected absence after mutations. For a board, batch-fetch assignments in one consistent read snapshot rather than doing one database query per row.

### 4. Merge bridges and all-or-nothing conflicts

Existing open windows 09:00–10:00 and 11:00–12:00 plus a new 09:30–11:30 window should yield one 09:00–12:00 absence, preserving the lowest existing ID and all distinct reasons.

If either affected window has any assignment, reject everything. Do not partially merge unassigned records before discovering protected coverage. Only genuinely overlapping connected windows combine; do not bridge an uncovered gap without an overlapping submitted window. Different teachers' windows never combine.

### Finding affected records efficiently

Baseline: `teacher_id = ? AND start_time < new_end AND end_time > new_start`, using an index beginning with `(teacher_id, start_time)`. This is simple and correct, but a B-tree cannot fully optimize both interval endpoints: old candidate rows may need filtering, with worst-case work proportional to that teacher's history. Do not promise logarithmic lookup solely because an index exists.

Optional optimization under the application's **non-overlapping existing absences per teacher** invariant:
1. Fetch the nearest existing interval whose start is before `new_start` (`ORDER BY start_time DESC LIMIT 1`); include it only if its end is after `new_start`.
2. Fetch intervals with starts in `[new_start, new_end)` in ascending order. Positive-duration rows in this range necessarily overlap the submitted interval.
3. These are all affected rows: extending to the first/last match cannot discover an additional interval overlapping a match, because existing teacher intervals do not overlap one another.
4. Check assignments on all matches, preserve the lowest ID and all distinct reasons, then update/delete inside one transaction.

With the appropriate index this is approximately `O(log t + m)` retrieval for `t` teacher intervals and `m` matches, plus assignment checks and indexed writes. It needs no custom interval tree. If legacy/direct-write data breaks the invariant, this optimization is not valid; repair/reject inconsistent data or use a robust interval-closure scan instead. Start with the clear baseline unless measurements justify optimizing it.

### 5. Time conversion and precision

- Same instant with different UTC offsets must compare equal after normalization.
- Reject impossible calendar dates before JavaScript can roll them forward.
- Truncate extra fractional-second digits consistently on every endpoint; validate normalized duration/containment/conflicts afterward.
- Test intervals collapsing to zero milliseconds and conflicts that disappear/change at the chosen millisecond resolution. This is a deliberate precision limit, not exact preservation of sub-millisecond instants.
- Allow overnight and multi-day absences without assuming start/end share a calendar date.
- Browser `datetime-local` has no timezone. During daylight-saving transitions a local time can be nonexistent or occur twice; naive conversion can silently shift or ambiguously select it. At minimum display the interpreted timezone/offset and detect nonexistent-time normalization. Explicit fold selection or a school IANA timezone is a possible future requirement.
- UTC timestamps locate instants but do not retain the original named timezone. Recurring school-local schedules need additional timezone modeling.

### 6. Network failures and retries

The server can commit a claim while its response is lost. Retrying should not create duplicate coverage; the overlap rules prevent that, but a `409` does not tell the client whether its first attempt succeeded.

Minimal recovery: show a useful error and reload current assignments before the user tries again. Disable pending buttons, but do not rely on that for server correctness. Repeated absence submissions should preserve distinct reasons without duplication; retries after intervening claims can still conflict. Durable idempotency keys are a future improvement, not a guarantee of this design.

Implemented: snapshot reads, explicit timezone/offsets, pending controls, refresh after writes/errors, and a last-updated/manual-refresh indicator. Failed reloads disable mutations until recovery. A lost response after commit is exercised in DOM/API tests and real Chromium; no automatic retry occurs. Snapshots remain point-in-time, not permanently fresh; polling/push and durable idempotency keys remain deferred.

### 7. Input, output, and storage boundaries

- Reject invalid IDs, unsafe integers, wrong roles, arrays/null where objects are expected, missing paired times, and non-string reasons.
- Keep malformed JSON and unexpected failures in the same JSON error format; Express defaults can otherwise produce HTML.
- Establish request/reason size limits and consider accumulated reasons after many merges. Never silently drop reasons to satisfy a limit.
- Render names/reasons as text; parameterize SQL. Multiline text, Unicode, quotes, and markup-like text must not break the UI or database.
- Proposed JSON reason storage should have a valid-array database constraint, with the API enforcing string elements and deduplication.
- Use restrictive foreign-key deletion behavior for accepted coverage; do not introduce cascade deletion that could silently remove assignments.
- Test reopening a file-backed database, preserve foreign-key settings on each connection, and close test databases.

## Real-world uses the current scope does not fully support

| Use case | Current limitation / future direction |
| --- | --- |
| Substitute cancels or becomes sick | Implemented: release a future assignment, or only the remaining portion of an ongoing one; retain elapsed coverage. Ended assignments cannot be cancelled. A retry after a full deletion returns `404`; refresh instead of blindly retrying. |
| Teacher returns early or changes a covered absence | Implemented explicit shortening: preserve earlier assignments, truncate crossing ones, remove later ones, atomically. Omitted cutoff means now; no backdating or extension. Ordinary protected-overlap merging remains forbidden. |
| Claiming a past or already-started shift | Ended requested windows and absences are rejected against an injected server clock. In-progress windows are allowed if their end is future; historical absence creation remains allowed. |
| Lunch breaks or separate teaching periods | The model treats the whole absence interval as needing continuous coverage. Excluding non-teaching periods requires explicit coverage requirements or separate windows. |
| Travel between schools | Back-to-back assignments are allowed. Locations and travel buffers are not modeled. |
| Qualifications, availability, workload | Informational certification metadata is stored and returned with users; expiry is displayed, not enforced for eligibility. No invented credentials or management/verification UI. Availability/workload engines remain deferred. |
| A teacher also serves as a substitute | Existing users have one role; true dual roles need a revised role model and conflict rules. |
| Recurring absences / district timezone | No recurrence engine or named school timezone; storing UTC alone is insufficient for future local-time recurrence. |
| Auditing original submissions | Merges preserve reasons, not original records/time-to-reason mappings. Counts represent consolidated windows, not incidents or submitted forms. |

## Production security and scaling limits

- Selected user IDs simulate actors. There is no login, ownership authorization, or protection against impersonation; validation does not make this deployable as a real staff portal.
- Reasons may contain medical/personal information. A production board needs role-based visibility, data minimization, and retention rules; a demo should use synthetic data.
- The user deprioritized reason-privacy and full security features for the exercise. Do not build those implicitly, but retain basic validation, safe text rendering, and parameterized SQL.
- Database cross-row protections currently assume writes go through the API. Maintenance scripts or later write endpoints must follow the same rules or stronger triggers must be added.
- Timed assignments make the domain model extensible, not infinitely scalable. SQLite still serializes writers. Keep transactions short, index conflict lookups, avoid per-row query loops, and revisit persistence for higher write concurrency.
- Pagination/filtering, bounded query ranges, migrations, backups, monitoring, and access-controlled deployment are production follow-ups rather than requirements to add automatically to the take-home.
- Dependency audit: six findings in the existing Vitest/Vite development-tool chain, including critical findings; production-only audit reports zero. No force/major upgrade was applied as part of frontend work. Review the dev toolchain separately and do not expose test/development servers or run untrusted tests.

## Suggested priority

1. Core backend and frontend are implemented/tested, including browser smoke checks. Next is the user's final walkthrough and submission review, not additional unapproved features.
2. Use separate absence windows around known breaks. Do not guess breaks from a continuous 09:00–16:00 request. A teaching-period calendar or required-coverage windows model would be a separate extension.
3. Certifications remain informational metadata, not proof of verification or enforced eligibility. No availability/workload engine is included.
4. Keep recurrence, travel buffers, authentication, full audits, and whole-absence cancellation before its start deferred.
