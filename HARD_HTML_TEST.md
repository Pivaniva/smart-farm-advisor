# Hard HTML Test (Final Before CSS)

Time target: 60-90 minutes
Rules:
1. HTML only (no CSS, no JS)
2. Use semantic tags wherever possible
3. Keep valid nesting and unique ids
4. Do not delete instruction comments from the test file

File to complete:
- `hard-html-test.html`

## Tasks
1. Add skip link at top of body: `href="#main-content"`.
2. Build header with:
   - site title
   - nav (`aria-label="Main navigation"`) using `ul > li > a`
   - links to `#about`, `#services`, `#projects`, `#faq`, `#contact`
3. Add `<main id="main-content">` wrapper.
4. About section:
   - heading + 2 paragraphs
   - figure with real image URL, meaningful alt, and figcaption
5. Services section:
   - heading
   - 4 article cards
   - each card has heading, paragraph, and link
6. Projects section:
   - heading
   - table with `caption`, `thead`, `tbody`
   - columns: Project, Owner, Status, Launch Date
   - at least 4 data rows
7. FAQ section:
   - heading
   - 4 `details` blocks, each with `summary` + paragraph
8. Contact section:
   - heading
   - form with `fieldset` + `legend`
   - fields:
     - name (text, required)
     - email (email, required)
     - phone (tel)
     - topic (select with 3 options)
     - priority (radio group: low/medium/high)
     - services needed (checkbox group: at least 3)
     - message (textarea, required)
   - submit button
   - labels correctly connected with `for`/`id`
9. Add `<aside>` with quick facts list (5 items).
10. Footer:
    - copyright paragraph
    - `address` with mailto and tel links

## Grading
- Beginner+: structure mostly correct but semantic/form gaps
- Intermediate: semantic sections + valid forms + table + FAQ
- Intermediate+: strong semantics + clean accessibility basics
- Advanced (HTML): fully valid structure, robust semantics, no major issues

When finished, tell me: `hard test done`
