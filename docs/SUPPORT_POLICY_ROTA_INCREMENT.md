# Support Operating Policy, Calendar, and Rota Increment

## Outcome

Crossly support operating rules are now controlled from the protected Admin web application rather than source code or an environment variable. The same database policy drives customer-ticket SLA snapshots, maintenance alerts, automatic assignment, manual assignment, and agent claims.

## Admin workflow

Open `/admin/support/settings` to manage:

- IANA timezone, initially `Asia/Dhaka`;
- business weekdays and local opening/closing time;
- first-response target from 1–10 business days;
- approaching-SLA alert threshold from 1–168 hours;
- named closed/holiday dates;
- agent shifts with start, end, and handover note;
- optional enforcement that new assignments require an active scheduled shift.

All mutations require Admin authorization, a trusted browser origin, strict validation, and an audit record. Policy updates use optimistic version checks. Overlapping active shifts for one agent are rejected. Shift cancellation preserves the record and audit history.

## SLA behavior

- New tickets calculate the due date from the configured timezone calendar.
- Weekends/non-business weekdays and configured holidays are skipped.
- The deadline is set to configured local closing time on the final business day.
- Due and approaching timestamps are stored on the ticket as immutable operational snapshots.
- Existing tickets are not repriced or silently moved when policy changes.
- Older tickets without an approaching snapshot retain the safe 24-hour fallback.

## Assignment behavior

When shift enforcement is enabled, an agent must have a current scheduled, non-cancelled shift in addition to being active, available, accepting assignments, and below capacity. If nobody qualifies, the ticket remains unassigned for Admin/queue handling. The system never bypasses the calendar or workload guard merely to force assignment.

## Verification

`npm run test:support-policy` verifies Admin-only policy changes, calendar/holiday exclusion, SLA snapshots, shift gating, overlap rejection, cancellation, audit behavior, and Admin/agent pages. `npm run test:support-workflow` remains the full RBAC, privacy, messaging, quality, and revocation regression suite.

## Production requirements

The owner must approve real support hours, holidays, language coverage, rota ownership, on-call/escalation procedure, response targets, staffing capacity, and customer-facing wording. The authenticated SLA maintenance scheduler and external notification providers still require production infrastructure.
