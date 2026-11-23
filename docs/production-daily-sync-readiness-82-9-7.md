# Farm Dashboard 82.9.7 — Production daily data-release readiness (proposal only)

Status: TEST BRANCH ONLY. No production authorization, no production deploy or setting change.

## Existing verified state

- GitHub Actions saves validated append-only daily market prices to main as server/price-history.json.
- The staging relay verified that GitHub Actions can fast-forward a separate branch, causing Render to deploy automatically.
- Production backend and frontend currently keep Auto-Deploy disabled.
- This document is not an instruction to enable a service or merge code.

## Recommended production mechanism after separate approval

1. Create a **dedicated production data-release branch** at an approved, already deployed production code commit, with the same approved application files. Do not use a branch that changes application code without review.
2. After the existing daily collection and data commit both succeed, an isolated publish job may retrieve the exact validated history from the recorded successful daily run or approved main commit, and compare it to the currently deployed data-release branch.
3. The job must reject if the candidate modifies/deletes any prior history record; if event IDs repeat; if the Bangkok observation date is wrong; if appended count exceeds 20; or if unrelated tracked files change.
4. Publish **only server/price-history.json** as a new commit on the dedicated data-release branch, preserving the approved backend code snapshot. The publisher must not push to main or to a source branch containing arbitrary application changes.
5. The Render production Backend would be configured to deploy that dedicated branch only **after explicit authorization** and an initial controlled deployment; keep frontend independent.
6. Wait for Render Live, then call the production history API read-only for all ten crops and check expected new dates, counts, and service health; alert and stop on mismatch.
7. No new records = no publish / no deploy. History validation failure = no publish / no deploy.

## Security and race conditions to resolve before production

- Use a minimal write-scoped job only for the designated release branch; read-only in collection, validation and API jobs.
- Avoid storing a production Render deploy hook/API token when the dedicated branch design works.
- Verify that the dedicated release branch has **approved baseline server code**, not a changing copy of main. GitHub Actions must never publish unapproved source changes.
- Preserve commit identity or provenance of the validated daily input, and re-check current release branch head immediately before pushing (fast-forward / lease / reject on race).
- Review branch protection rules, GitHub Actions token permissions, and how manual users might be able to push directly to the data-release branch. A CI guard alone does not prevent direct writes.
- GitHub GITHUB_TOKEN pushes may not trigger other GitHub Actions push workflows. Prefer the controlled publishing job in the same daily workflow with a Render branch-triggered deploy, or explicitly use workflow_run semantics with provenance checks.
- Staging tests showed the full branch fast-forward approach. A history-only release commit that cannot change application files still needs an end-to-end staging drill before production.
- The existing staged validation guard intentionally rejects some potential same-crop multi-event days; reconcile its policy with the actual event schema before deployment.
- Check failed or partial (fewer than ten crop rows) price collection; do not advertise a complete day when crops are missing.
- Daily GitHub collection is not proof that Render has the newest data: always verify the deployed commit and API after rollout.
- Live API verification should use history response fields status, data, count and check crop dates.
- Confirm independent backup bytes before enabling automated deployment.

## Proof points tested on staging

- 884 -> 894 records, ten genuine observations on 2026-11-22: append-only, no old rows changed.
- GitHub Actions required tests and only stage-promote commit changes allowed.
- Invalid extra tracked file caused the promotion job to fail and did not deploy.
- Auto-Deploy staging service followed a new commit and reached Live.
- Read-only API smoke tested all ten crops and confirmed 2026-11-22 history.
- Test future date dynamically (without permanent one-day replay exception) using server/daily-history-gate.test.mjs.

## Approval needed to continue

A separate approval is required for modifying main, creating/configuring a production release branch or changing Render production Backend settings. This document only prepares the plan and test utilities.
