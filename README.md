# Take-Home Exercise: Substitute Teacher Absence & Coverage Board

**Timebox:** ~60 Minutes  
**AI Usage:** Encouraged and expected (Cursor, Claude Code, Gemini CLI, ChatGPT, Copilot, etc.)

## Overview
Welcome! In this assessment, we want to see **how you collaborate with AI to engineer a reliable feature**. We are not grading you on CSS polish or typing speed. Instead, we are evaluating how you prompt, how you review and refine AI-generated system designs, how you handle backend business logic and edge cases, and how you verify your work with automated tests.

This starter repository already includes:
- An **Express** backend (`src/app.js`)
- A **SQLite** database (`src/db.js`) pre-seeded with a `users` table containing Teachers and Substitutes
- A basic **HTML/JS frontend shell** (`public/index.html`) served at `http://localhost:3000`
- A pre-configured **Vitest + Supertest** test runner (`tests/api.test.js`)

---

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.
3. Run the automated test suite:
   ```bash
   npm test
   ```

---

## The Task: Absence & Sub Coverage

Using the existing `users` table (`id`, `name`, `email`, `role` where role is `'teacher'` or `'substitute'`), build the **Absence & Shift Coverage** feature:

1. **Log an Absence:** A Teacher can create an absence specifying their user ID, a `start_time` (ISO timestamp or date/time), an `end_time`, and an optional reason/subject.
2. **View Absences:** The dashboard displays all absences, showing the absent teacher's name, the time window, current status (`Open` vs. `Claimed`), and the assigned substitute (if claimed).
3. **Claim an Absence:** A Substitute can claim an `Open` absence to cover that shift.
4. **Conflict & Validation Rules:** Make sure your database schema and API layer enforce sensible real-world constraints (e.g., preventing double-claiming, preventing overlapping schedules for the same substitute, validating roles and timestamps).

---

## Your 4 Required Deliverables

Please follow this workflow so we can evaluate your engineering process:

### Step 1: Plan & Diagram (`ARCHITECTURE.md`)
Before writing application code, ask your AI assistant to propose a database schema and API flow for this feature.
- Paste a **Mermaid.js** diagram (Entity-Relationship Diagram and/or API sequence diagram) into `ARCHITECTURE.md`.
- Complete the **"Design Review & Corrections"** section in `ARCHITECTURE.md` with 2–3 bullet points explaining what you changed, tightened, or corrected from the AI's initial suggestion (e.g., missing constraints, edge cases, or schema flaws).

### Step 2: Database & API Layer (`src/db.js` & `src/app.js`)
- Add your new table(s) to `createDb()` in `src/db.js`.
- Build the REST endpoints in `src/app.js` to create absences, list absences, and claim an absence.
- Ensure all conflict and validation checks happen on the backend and return appropriate HTTP status codes (`400`, `409`, etc.).

### Step 3: Minimal UI (`public/index.html`)
- Hook up the existing sections in `public/index.html` so a user can create an absence, view the list of open/claimed absences, and click a button to claim an open shift as a selected substitute.
- **Do not spend time on CSS styling**—the existing minimal stylesheet is sufficient.

### Step 4: Automated Tests & AI Log (`tests/api.test.js` & `AI_LOG.md`)
- Use your AI to generate integration tests in `tests/api.test.js` covering both the happy path and the edge-case rejections (overlaps, double-claims, invalid roles/times).
- Fill out `AI_LOG.md` with an export/link to your AI chat or CLI session and a brief note on an edge case or bug you caught during development.

---

## Submission Instructions
1. Commit your progress at logical milestones (e.g., `1. Architecture plan`, `2. DB & API`, `3. UI & Tests`) so we can see your progression in `.git`.
2. **Delete `node_modules/`** and `school.db`, then zip the entire project folder (making sure the hidden `.git` folder is included) and send it back to us.
