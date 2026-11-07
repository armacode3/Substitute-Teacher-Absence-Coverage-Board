# AI Collaboration Log

## 1. Tooling Used
- **AI Assistant / IDE / CLI:** OpenCode coding-agent session.
- **Model:** OpenAI GPT-6.1 Sol (`openai/gpt-6.1-sol`).

## 2. Session Transcripts / Key Prompts

Key prompts, decisions, and verification from this session are recorded below rather than claiming a transcript export or share link exists.

### Planning and architecture review

- The user requested reading the starter architecture and `README.md`, proposing alternatives, building a roadmap, and updating `agents.md` after changes. The assistant created `ROADMAP.md`, established a passing one-test baseline, and initialized Git with approval.
- Initial AI proposal: a single absence table with nullable substitute assignment, derived Open/Claimed status, normalized timestamps, and an immediate claim transaction.
- User: "I belive that overlapping absences for the same teacher should be combined into one?" Review established merging only open absences, with no partial writes when accepted coverage would be affected.
- User approved: "We can merge overlapping open teacher absences bu cannot merge overlaps involving claimed absences with substitutes?" The design records `409` rejection and unchanged coverage for that case.
- The user compared Julian dates, seconds, and milliseconds and approved back-to-back substitute shifts, separate adjacent teacher absences, HTTP response codes, and layered enforcement.
- User: "In the real world it is definetely possible for multiple substitutes to split a teachers work hours. I belive it would make sense to have this implemented for our system." This explicitly expands the original exercise to split coverage, rather than only preparing for it later.
- User selected the recommended ISO contract, allowing JavaScript-friendly UTC millisecond storage, and said: "Let's preserve the distinct reasons" when merging.
- Revised design: timed assignment records, derived partial/full coverage and gaps, no overlapping coverage within an absence, no overlapping substitute assignments globally, and merge rejection whenever any affected absence has even partial coverage.
- The user approved retaining the lowest existing ID during merges and the structural integrity boundaries. They challenged rejecting valid timestamps with more than millisecond precision; the revised policy accepts them with explicit fractional-second truncation and revalidates normalized intervals.
- The user requested stepping back to examine unhandled real-world cases and failure modes. Added `DESIGN_REVIEW.md` distinguishing prospective correctness risks from unsupported product/production use cases. A key new finding is stale intent: an ID-only claim could cover an expanded merge-survivor window the substitute never saw. Explicit submitted times limit that risk; stricter request/version policies remain for discussion.
- At the risk-review stage, the user approved required claim times, ended-window rejection, visible timezone, duplicate-click/network recovery, and concurrency/rollback priority. They requested cancellation and early return while deferring full audits and reason-privacy features. Certification/breaks were then still under discussion. Documented gap scanning, indexed lookup tradeoffs, read snapshots, and lifecycle proposals before feature code.

### Implementation and verification

- The user approved proceeding after final architecture review: linear gap scanning, simple indexed merge lookup, recommended cancellation, lightweight certification metadata, and read/write concurrency protections. Finalized lifecycle endpoints and documented implementation defaults before application code.

- Before application changes: `npm test` passed the existing seeded-users test (1 test).
- Architecture/document edits: `git diff --check` passed. After the user's syntax report, all three diagrams passed Mermaid 11 `parse()` validation (ERD, create/merge flowchart, claim sequence). Used JSDOM for the flowchart's DOM-dependent text sanitization. This validates syntax, not visual browser rendering; tools were installed only in `/tmp/opencode/aps-mermaid-11XweJ`, not project dependencies.
- Architecture committed before application code: `512f9ab`, `docs: finalize reviewed scheduling architecture`.
- Implemented four-table schema; strict timestamp/ID/body validation; transactional create/merge/list/claim/cancel/early-return service; certification metadata; and consistent JSON errors. Kept the existing runtime dependencies and CommonJS style. Backend milestone: `2e19f21`.
- First API/gap suite: 71 tests passed. Added independent child-process workers against a temporary file-backed database: 80 tests passed, including nine concurrency/persistence scenarios.
- Final robustness pass added tests for accumulated reasons, post-write trigger failures, and pre-epoch/expanded-year timestamps. `npm test -- --sequence.shuffle --sequence.seed=20261107`: **84 tests passed in 3 files** (72 API, 3 gap, 9 concurrency/persistence).
- Concurrency tests cover same-time claims, substitute double-booking across absences, adjacent split claims, merge/claim, cancel/claim, early-return/claim, coherent read snapshots during shortening, lock timeout/recovery, and database reopening. Temporary worker processes/connections/files are cleaned up.
- Rollback tests inject SQLite trigger failures after intermediate mutations for merging, claiming, cancellation, and early return. Assertions verify unchanged dates/reasons/assignments and sanitized errors.

### Frontend implementation and verification

- User: "if all the tests are passing and everything is correctly implemented following the architecutre then lets move on to the frontend". Connected the reviewed API without changing backend behavior or adding a frontend framework/build step.
- `public/index.html` retains the existing styling with small responsive/disabled-state additions; `public/app.js` contains the vanilla DOM/event/fetch behavior. Implemented actor selectors, forms, all statuses/assignments/gaps, explicit selected-range claims, cancellations/early return, credentials, timezone/offset previews, safe text rendering, draft preservation, and pending/recovery states.
- Added dev-only JSDOM and `tests/frontend.test.js`. Fetch calls are bridged to the actual Express/in-memory SQLite API, not a fake business-logic implementation. Initial 22 cases passed; two additional timeout/non-JSON recovery cases bring the UI count to 24.
- `npm test` and `npm test -- --sequence.shuffle --sequence.seed=20261107`: **108 tests passed in 4 files** (72 API, 3 gap, 9 concurrency/persistence, 24 frontend). Final Chromium smoke and all three Mermaid parser checks also passed after the last UI change. Whitespace validation passed with `git -c core.whitespace=cr-at-eol diff --check`, respecting the inherited lockfile line endings.
- Installed Playwright/Chromium only under `/tmp/opencode/aps-browser-UGqW6a`, outside project dependencies. Command: `PLAYWRIGHT_BROWSERS_PATH=/tmp/opencode/aps-browser-UGqW6a/browsers node /tmp/opencode/aps-browser-UGqW6a/smoke.cjs`, run from the project folder. The temporary script launches the real HTTP app with an in-memory DB and deterministic clock, and closes all resources afterward.
- Chromium 158 smoke results: desktop/mobile create → split → full coverage; safe markup-like text and credential display; cancellation reopening a middle gap; early return removing later assignments; stale conflicting claims in two pages; a committed write whose HTTP response is deliberately lost with no automatic retry; New York later DST-fold preservation and spring-forward rejection. All passed, with no uncaught browser JavaScript errors. Desktop/mobile screenshots were inspected and live only in the temporary validation directory, not the submission.
- Dependency checks: six findings in the existing Vitest/Vite dev-tool chain (3 moderate, 1 high, 2 critical). `npm audit --omit=dev` reports zero findings. No unrelated major/force upgrades were applied; this limitation is documented in `DEMO.md`.

### User-requested time-picker refinement

- User requested removing millisecond inputs/display, Google Calendar-like 15/30-minute choices with double-click editing for specific times, and zero rather than current-time defaults.
- Implemented separate date and time controls shared by creation, claiming, and early return: blank dates, midnight defaults, 96 fifteen-minute choices, real double-click or keyboard/touch-friendly button to edit whole seconds, and Clear/reset. No gap is automatically chosen; explicit gap selection can fill its known bounds.
- Backend timestamp/storage behavior is unchanged. Unchanged chosen gap bounds preserve the original ISO instant/precision internally; manual date/time edits produce whole-second values. Switching back to slots preserves an exact custom value instead of silently rounding it.
- Revised DOM tests drive visible controls, not hidden timestamp values. Added midnight/blank defaults, quarter-hour selection, second editing, no snapping, overnight boundaries, draft preservation, API precision, and partial early-return validation. `npm test` and the shuffled run (`--sequence.shuffle --sequence.seed=20261107`) both pass **118 tests** (34 frontend, 84 backend/gap/concurrency). CRLF-aware whitespace validation also passed.
- Updated/reran isolated Chromium smoke: real double-click seconds entry, exact payload, midnight reset, no displayed milliseconds, desktop/mobile width, lifecycle actions, two-page conflicts, lost committed response, and New York DST all passed with no uncaught page errors. No dependencies were added for this revision.

### User-requested AM/PM refinement

- User: "Can you add a PM AM option so the user doesn't have to translate into miliatary time". Time choices/previews/board now use 12-hour labels; the exact editor uses hh:mm:ss text plus an explicit AM/PM selector rather than relying on native time-input locale settings.
- Midnight stays the zero-time default, displayed as 12:00 AM; noon is 12:00 PM. Canonical 24-hour/ISO values remain internal; no API/storage/dependency changes. Invalid or incomplete exact text cannot be silently switched/rounded into midnight. AM/PM and raw incomplete text survive refresh.
- Frontend suite: 47 cases pass. Normal and shuffled full runs (`--sequence.shuffle --sequence.seed=20261107`) both pass **131 tests**. Added midnight/noon/AM/PM, invalid 00/13-hour/minute/second text, and PM/incomplete draft regressions. Whitespace check passed.
- Isolated Chromium smoke also passed: midnight/noon labels, explicit AM default, real double-click input, and an exact **1:30:05 PM** early return verified as 13:30:05 UTC in the UTC test context. Desktop/mobile, lifecycle/conflict/lost-response, and New York DST checks remain passing with no page errors.

## 3. Edge Cases & Course Corrections

- **Design blind spot, not a reported runtime bug:** the original nullable substitute column could not represent split coverage. The assistant also proposed deferring split coverage after introducing an assignments table; the user requested real split coverage now. The revised design uses timed assignments and checks both substitute availability and whether the selected absence portion is already covered. Merely allowing multiple assignment rows would not prevent double coverage or detect gaps.
- **Merge safety:** the user's merge request exposed that combining dates could silently expand an accepted substitute commitment. Reject merging if any affected absence already has an assignment, including partial coverage, and keep merge checks/writes atomic with claims.
- **Reason preservation:** different reasons must not be discarded or used alone to block a valid open-window merge. Distinct reasons are retained; a full submission/time-window audit history is not implied.
- **Actual documentation bug found by the user:** the claim sequence failed Mermaid parsing at its final note. Reproduced the exact line-49 parse error using an isolated Mermaid 11 installation outside the project. The semicolon inside the note was treated as a statement separator, leaving the rest as invalid diagram syntax. Replaced it with "and"; the corrected claim sequence and both other diagrams now pass parser validation.
- **Precision correction:** the assistant initially proposed rejecting any fraction longer than milliseconds. The user questioned discarding an otherwise usable timestamp. Accept and truncate extra fractional digits after validating the complete timestamp, expose normalized values in responses, and reject intervals that collapse to zero duration. Truncation discards sub-millisecond information; it does not preserve the original timestamp exactly.

- **Implementation review correction:** a four-digit-only timestamp parser could return an expanded-year ISO string after offset normalization near year zero, then reject that same value on the next request. Extended parsing to signed six-digit years, bounded dates to JavaScript's representable range in the API and schema, and added round-trip/pre-epoch regressions. This was identified during code review; no prior failing test run is claimed.
- **Scalability detail:** avoided spreading all merge candidates into `Math.min`/`Math.max` function arguments, which can hit JavaScript argument limits; use reductions. Kept the clear indexed overlap query and defensive closure expansion rather than adding an unmeasured custom interval index.

- **Frontend review correction:** comparing two separate `Date.now()` calls could make a blank "return now" cutoff appear to be in the past between calls. Capture the browser clock once and use the server's now default; an advancing-clock regression test verifies it.
- **Browser-discovered defect:** all initial DOM tests passed, but Chromium at 375px found page-wide horizontal overflow from the staff grid's intrinsic card width. Diagnosed overflowing element bounds and added `min-width: 0` to the existing card rule. The full browser scenario passed after the fix; table overflow is confined to its scroll wrapper.
- **DST safeguard:** converting a prefilled later-fold gap into timezone-less local text and reparsing it could select the earlier occurrence. Preserve the original ISO instant while its input remains unchanged, including across refreshes; display the offset preview for edits. DOM/API and real-browser tests verify the later occurrence is not shifted.
- **Split-control review correction:** snapshotting only a complete timestamp would discard a partially entered date/time during refresh; an incomplete early-return edit could then become the default "return now". Store the visible date/time/editor state independently as well, and require a date when a time was edited. A regression verifies incomplete drafts remain incomplete, not silently reset.

Browser checks cover Chromium desktop/mobile emulation, not every browser/device. Full authentication, production security, credential verification, and dependency-toolchain upgrades remain outside the agreed feature scope. Final user walkthrough and submission cleanup are still pending approval.
