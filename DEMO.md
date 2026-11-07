# Running and Reviewing the Demo

## Start

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
6. **Merge:** create a separate open absence, then another overlapping open window for that same teacher. They combine under the lowest existing ID and retain distinct reasons. Any existing coverage blocks merging; adjacent windows remain separate.
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
- The directory displays certification metadata if records exist. No credentials are invented for seeded users, and certification does not enforce eligibility.

## Verification

```bash
npm test
npm test -- --sequence.shuffle --sequence.seed=20261107
```

131 tests cover API rules, normalization, rollback, gaps, independent-process concurrency/persistence, and DOM/API interactions including AM/PM, midnight/noon, and draft preservation. Isolated Chromium checks cover desktop/mobile, real double-click/second editing, explicit PM conversion, full workflows, conflicting pages, lost responses, and New York DST. Chromium/Playwright is not a project dependency; committed DOM tests use JSDOM through `npm test`.

## Known limits

No authentication, credential verification/management, recurrence, travel/workload rules, full audit history, or automatic lunch calendar. Schema cross-row invariants assume writes use the API. See `ARCHITECTURE.md` and `DESIGN_REVIEW.md` for boundaries.

The dependency audit currently reports six findings in the starter's Vitest/Vite development-tool chain (including critical findings). `npm audit --omit=dev` reports zero production-dependency findings. A toolchain update needs separate review/testing; no `npm audit fix --force` was applied. Do not expose development/test servers or run untrusted test code.

Submission cleanup has not been performed: keep dependencies and local data until the final review, then follow the original `README.md` packaging instructions with user approval, including the hidden `.git` directory.
