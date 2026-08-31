# Product

## Register

product

## Users

HR admins and branch managers at a multi-branch company, using this during normal work hours on a desktop browser (occasionally tablet). Their job on any given screen is a quick lookup or a single targeted edit — checking who's on the roster, what role/branch someone is in, occasionally editing or inviting an employee — not extended bulk data-entry sessions. Speed of scanning and confidence that they clicked the right thing matter more than surfacing every possible action at once.

## Product Purpose

Internal attendance tracking for a company with three branches. Staff check in/out via QR + GPS; HR reviews flagged attendance, approves leave/remote work, manages the employee roster, and exports compliance reports. Success looks like HR completing routine tasks (find an employee, check their status, make one edit) in seconds, without the interface feeling like a spreadsheet dump.

## Brand Personality

Clean, calm, trustworthy — a flat, high-contrast, no-nonsense internal tool. No gradients, no drop shadows, square-ish corners (existing `--radius-flat` system). One brand teal (`--color-brand-primary`) used deliberately; status colors (approved/pending/flagged/declined) kept semantically separate from brand color.

## Anti-references

Should not look like a dense spreadsheet/Excel export — no wall-to-wall bordered grid cells, no forcing every column and every row action into view at all times. Should not read as over-engineered SaaS admin (no gradient text, no hero-metric tiles, no card-in-card nesting).

## Design Principles

- Scannable over exhaustive: the default table view shows what HR needs at a glance (name, role, branch, status); secondary/rare actions move behind a clear affordance rather than sitting inline.
- Breathing room over density: generous row height and padding beat cramming more columns into the same width.
- One primary action per row is visible; everything else is one click away, not zero.
- Consistent with the existing flat design system — reuse existing tokens/utilities (`card`, `btn-*`, `badge`, `field`) rather than inventing new visual language.

## Accessibility & Inclusion

Standard web accessibility: sufficient color contrast (existing tokens already meet this), full keyboard navigation, visible focus states (already implemented via `:focus-visible`), no reliance on color alone to convey status (existing badges pair color with text).
