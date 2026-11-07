# AI Collaboration Log

## 1. Tooling Used
- **AI Assistant / IDE / CLI:** OpenCode coding-agent session.
- **Model:** OpenAI GPT-6.1 Sol (`openai/gpt-6.1-sol`).

## 2. Session Transcripts / Key Prompts

Key prompts and decisions from this session are recorded below rather than claiming a transcript export or share link exists. Implementation and testing entries will be added as that work happens.

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
- Latest user review approved required explicit times for every claim, ended-window rejection, visible timezone, duplicate-click/network recovery, and concurrency/rollback priority. The user requested substitute cancellation and teacher early return, while deferring full audits and reason-privacy features. Certification and breaks are under discussion. Documented linear gap scanning, indexed overlap-lookup tradeoffs, read snapshots, and proposed lifecycle mechanics; no feature code has been written.

### Implementation and verification

- The user approved proceeding after final architecture review: linear gap scanning, simple indexed merge lookup, recommended cancellation, lightweight certification metadata, and read/write concurrency protections. Finalized lifecycle endpoints and documented implementation defaults before application code.

- Before application changes: `npm test` passed the existing seeded-users test (1 test).
- Architecture/document edits: `git diff --check` passed. After the user's syntax report, all three diagrams passed Mermaid 11 `parse()` validation (ERD, create/merge flowchart, claim sequence). Used JSDOM for the flowchart's DOM-dependent text sanitization. This validates syntax, not visual browser rendering; tools were installed only in `/tmp/opencode/aps-mermaid-11XweJ`, not project dependencies.
- No absence/assignment application code or new integration tests have been written yet. Add actual results here during implementation.

## 3. Edge Cases & Course Corrections

- **Design blind spot, not a reported runtime bug:** the original nullable substitute column could not represent split coverage. The assistant also proposed deferring split coverage after introducing an assignments table; the user requested real split coverage now. The revised design uses timed assignments and checks both substitute availability and whether the selected absence portion is already covered. Merely allowing multiple assignment rows would not prevent double coverage or detect gaps.
- **Merge safety:** the user's merge request exposed that combining dates could silently expand an accepted substitute commitment. Reject merging if any affected absence already has an assignment, including partial coverage, and keep merge checks/writes atomic with claims.
- **Reason preservation:** different reasons must not be discarded or used alone to block a valid open-window merge. Distinct reasons are retained; a full submission/time-window audit history is not implied.
- **Actual documentation bug found by the user:** the claim sequence failed Mermaid parsing at its final note. Reproduced the exact line-49 parse error using an isolated Mermaid 11 installation outside the project. The semicolon inside the note was treated as a statement separator, leaving the rest as invalid diagram syntax. Replaced it with "and"; the corrected claim sequence and both other diagrams now pass parser validation.
- **Precision correction:** the assistant initially proposed rejecting any fraction longer than milliseconds. The user questioned discarding an otherwise usable timestamp. Accept and truncate extra fractional digits after validating the complete timestamp, expose normalized values in responses, and reject intervals that collapse to zero duration. Truncation discards sub-millisecond information; it does not preserve the original timestamp exactly.

No application implementation bug has been observed yet; the user-reported Mermaid syntax bug is a reproduced documentation defect. Record application bugs and test-driven fixes here as development proceeds.
