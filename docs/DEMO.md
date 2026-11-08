# Running and Reviewing the Demo

## Start

Run these commands from the project root, not the `docs/` folder.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The server uses `school.db` by default; set `DB_PATH` to use a different SQLite file. User IDs in the selectors simulate actors; this is not an authenticated staff portal.

## Suggested walkthrough

1. **Create:** select Alice as teacher. Dates start blank and times start at **12:00 AM (midnight)**. Choose a future date and **9:00 AM–4:00 PM** using the 15-minute choices, plus an optional reason. Submit and confirm **Open**.
2. **Split coverage:** select David and explicitly choose the uncovered **9:00 AM–4:00 PM** window. Keep the start but select a **12:00 PM (noon)** end. Claim it; the board becomes **Partially Covered**, with noon–4:00 PM uncovered.
3. **Complete coverage:** select Sarah, choose the remaining **12:00 PM–4:00 PM** window, and claim it. The board becomes **Claimed** with both assignments.
4. **Cancel:** with Sarah still selected, cancel her remaining coverage and confirm. That portion reopens. For an assignment already underway, elapsed coverage is retained.
5. **Early return:** select Alice. In her card, choose an earlier end after the start (for example, **11:00 AM** on the same future date), then confirm **Shorten absence**. Crossing assignments shorten; later ones are removed. Blank cutoff means return now and only works after the absence starts.
6. **Merge existing records:** on a separate future date with no coverage, create two open windows for Alice: **9:00–10:00 AM** and **11:00 AM–12:00 PM**. Then submit **9:30–11:30 AM**, which overlaps both. One record remains under the lowest existing ID; the success message names the higher ID that was removed. Distinct reasons are retained. Any coverage on an affected record blocks merging.
7. **Conflict:** open the portal in a second tab. Have both tabs attempt the same uncovered time. The second conflicting claim is rejected and its board refreshes; no duplicate coverage is created.

## Time and recovery behavior

- Inputs use your browser's local timezone. The timezone and resolved UTC offsets are displayed; the API stores normalized UTC milliseconds.
- Times use a 12-hour clock with explicit AM/PM labels, starting at **12:00 AM**, not the current time. Double-click or use **Edit exact time** to type `hh:mm:ss` and choose **AM** or **PM**. Hours must be 1–12; `12 AM` is midnight and `12 PM` is noon. Milliseconds are not shown/entered. Returning to slots does not silently round exact times; **Clear** restores a blank date and midnight.
- Claim dates/times remain unselected until you choose a coverage gap. An unchanged chosen gap retains its exact stored instant internally, including any API-origin millisecond precision, without exposing fractional-second controls.
- Use separate absence windows around breaks. Lunch periods are not inferred.
- Prefilled gap times preserve their exact instant, including the later occurrence of a repeated daylight-saving time. Manually typed repeated times use the browser's earlier occurrence, shown in the preview; nonexistent spring-forward times are rejected.
- All claims submit explicit start/end values. Switching actors or refreshing does not silently expand an edited range.
- Controls are disabled while saving. After an uncertain network outcome, the UI reloads current state without automatically repeating the write. If reloading fails, mutations remain disabled until **Refresh directory & board** succeeds.
- The last-update time is visible. This is a refresh-based board, not a permanently live view.
- The board is chronological (earliest absence start first), not sorted by ID. A higher ID can appear before a lower one without indicating a failed merge.
- The directory displays certification metadata if records exist. No credentials are invented for seeded users, and certification does not enforce eligibility.

## Understanding create/merge feedback

- **Created:** a new record was added. Adjacent windows stay separate: an absence ending at midnight and another beginning at that same midnight do not overlap.
- **Updated existing absence:** the submission extended or added reasons to one existing open record. There was no second existing record to delete.
- **Already covers this request:** an identical/contained request added no time or reasons; nothing was changed or removed.
- **Merged overlapping open absences:** multiple existing records consolidated. The message names the surviving lowest ID and the removed IDs.
- **Coverage conflict:** any assignment, even partial coverage, prevents merging its absence. Overlapping only an uncovered portion of that same absence still does not bypass this protection.

For example, Nov 14 at 10:00 AM → Nov 16 at 12:00 AM is adjacent to Nov 16 at 12:00 AM → Nov 18 at 11:00 AM. Those remain two records. To test deletion, use genuinely overlapping, completely unassigned records as in step 6.

## Verification

Final review environment: Node.js **v25.2.1**, npm **11.11.0**. No frontend build step is needed. `better-sqlite3` is a native dependency; environments without a compatible prebuilt binary may need native build tools.

```bash
npm test
npm test -- --sequence.shuffle --sequence.seed=20261107
```

136 tests cover API rules, normalization, rollback, gaps, concurrency/persistence, DOM/API interactions, AM/PM, and accurate create/merge outcomes. Isolated Chromium checks also reproduce the exact November adjacency/retry case and real consolidation with surviving/removed IDs. They cover desktop/mobile, lifecycle/conflicts, lost responses, and New York DST. Playwright is not a project dependency; committed DOM tests use JSDOM through `npm test`.

Final review also verified `npm ci` followed by `npm test` in an isolated source copy without the working database or existing dependencies: all **136 tests passed** using a separate OS temporary directory. All three Mermaid diagrams and both Chromium checks passed again.

## Known limits

No authentication, credential verification/management, recurrence, travel/workload rules, full audit history, or automatic lunch calendar. Schema cross-row invariants assume writes use the API. See [ARCHITECTURE.md](../ARCHITECTURE.md) and [DESIGN_REVIEW.md](./DESIGN_REVIEW.md) for boundaries.

The dependency audit currently reports six findings in the starter's Vitest/Vite development-tool chain (including critical findings). `npm audit --omit=dev` reports zero production-dependency findings. A toolchain update needs separate review/testing; no `npm audit fix --force` was applied. Do not expose development/test servers or run untrusted test code.

Submission cleanup has not been performed: keep dependencies and local data until the final review, then follow the original [README.md](../README.md) packaging instructions with user approval, including the hidden `.git` directory.

## Final README requirement check

- [x] Reviewed Mermaid schema/API flows and three genuine design corrections in [ARCHITECTURE.md](../ARCHITECTURE.md); architecture commit `512f9ab` precedes application code.
- [x] SQLite schema and backend create/list/claim endpoints, role/time validation, interval conflict checks, transactional writes, and rollback tests.
- [x] Functional teacher/substitute UI showing names, windows, assignments, and Open/Claimed status. Partially Covered and lifecycle operations are approved extensions.
- [x] Happy-path/edge-case API tests plus independent-process concurrency and frontend tests: **136 passing**, including a shuffled run.
- [x] [AI_LOG.md](../AI_LOG.md) records actual collaboration, corrections, and discovered bugs. User confirmed three overlapping absences consolidated under the lowest ID.
- [x] Logical architecture/backend/frontend/refinement commits preserved in `.git`.
- [x] Attach a **readable chat/CLI export or link** in [AI_LOG.md](../AI_LOG.md) as required by README line 66: [AI_TRANSCRIPT.md](./AI_TRANSCRIPT.md), converted from the stored session with original user/assistant wording. Internal reasoning and tool payloads are excluded; see its scope notes.
- [ ] Owner review of the readable transcript for privacy before external sharing. The user authorized the final local Git commit including the transcript and documentation; no public upload has been performed.
- [ ] With user approval, perform final cleanup and create/inspect the submission ZIP: include hidden `.git`, exclude `node_modules/` and generated SQLite files. Preserve the user's working demo data until that approval.

No core architecture blocker was identified in the final review. Existing development-tool audit findings remain disclosed above; this is a take-home implementation, not a production-security sign-off.
