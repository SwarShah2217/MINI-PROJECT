# SyncLAN validation

## Repeatable non-destructive checks

From the repository root:

```powershell
node --test backend/test/*.test.js frontend/test/*.test.js
if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed' }
$checkFiles = @(rg --files backend/src backend/test frontend -g '*.js') + @('backend/app.js')
foreach ($checkFile in $checkFiles) {
    node --check $checkFile
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $checkFile" }
}
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed' }
```

Alternatively, run `npm.cmd test` from `backend` for both test suites.
The seven test files contain 49 tests: 34 backend/feature tests and 15 desktop
UI tests. `backend/test/helpers.js` supplies isolated module loading, simulated
sockets and an in-memory filesystem. No test starts a real transfer, listens on
LAN ports or reads/writes the runtime downloads, temp or checkpoint directories.

Coverage includes receiver finalization and transfer-ID locks; interrupted and
complete checkpoint verification; sender ACK/recovery/queue behavior; transfer
encryption/compression/framing; legacy chat, sync and pairing; speed/ETA/theme
behavior; actual discovery response rendering; request and approval guards; and
request-banner visibility across all seven views. Simulated API responses are
test fixtures only, never production devices.

These checks cannot establish browser pixel layout, actual Windows disk/network
behavior, discovery broadcast reliability, cross-client timing or notification
delivery. Do not describe the remaining live checks as passed.

## PC1 browser review without live transfers

Use an already-running backend if available; refreshing frontend assets does
not require a restart. Backend changes need separate restart approval.

- Open each view, reload and use Back/Forward. Check labels, visible keyboard
  focus, skip link, form state and hidden-view tab behavior.
- Check light/dark themes across views, persistence after reload, and layouts
  around 1280, 900, 700 and 375 pixels without horizontal overflow.
- Confirm disconnected/unavailable states disable invalid transfer/chat/sync
  actions while navigation/settings remain usable.
- Review progress, speed/ETA, incoming/outgoing labels and recovery controls.
  Do not click recovery or connect merely to validate rendering.
- Check optional notification permission/denial behavior; actual incoming-event
  notification delivery requires an approved live test.

## Two-PC manual sequence: separate approval required

First inspect PC2 and prepare a reviewed checkout using the
[release plan](GIT_RELEASE_PLAN.md). Preserve existing branches, local changes,
stashes and all runtime data. Do not start/restart services without approval.
An isolated checkout does not change the already-running backend.

After compatible code is reviewed on both PCs and live testing is approved:

1. Verify real Nearby Devices names/IPs appear and expire correctly. Request a
   connection, reject it, retry and accept. Confirm connecting/connected/
   disconnected states. A remote failure must say rejected-or-failed rather
   than claim a reason the status API does not provide.
2. Keep a connection request pending while switching and scrolling through every
   view. Repeat for file approval. Test duplicate clicks, stale/expired requests,
   unavailable peers and competing tabs. Check PIN/QR separately: a valid pairing
   token follows the existing authenticated automatic-accept path.
3. Use newly created, uniquely named test files in separate test directories.
   Test file Reject and Accept in both directions; compare source/destination
   SHA-256 with `Get-FileHash -LiteralPath '<fresh-file-path>' -Algorithm SHA256`.
4. With fresh empty, compressible, incompressible and larger fixtures, check
   queueing, Pause/Resume/Cancel, progress, speed/ETA and verification state. Send
   chat messages and attachments in both directions; check notifications with
   permission granted and denied.
5. Interrupt only a fresh fixture first. Preserve its source/partial/checkpoint;
   explicitly find the retained source and request recovery, then explicitly
   accept on the receiver. Compare final hashes. Testing restart recovery needs
   distinct service-restart approval.
6. Preview whole/selective sync using fresh source/destination folders. Confirm
   new/changed/unchanged entries, named destination/peer confirmation, per-file
   receiver approval, final contents and history. Edit paths/change peer or
   disconnect after preview: the stale confirmation must be disabled.
7. Only after the fresh recovery tests pass, verify the original protected source
   size/SHA-256 against its receiver checkpoint. Stop on a mismatch or missing
   data. Obtain explicit approval before any recovery action involving that
   protected transfer; never regenerate, reset or replace its files or backups.

Record observed results, tested commits on both PCs, Node versions and remaining
failures in a local report. Keep machine paths, addresses and transfer metadata
out of published documentation.

## Known protocol/UI limits

- Remote connection rejection and socket failure both become `disconnected` in
  the existing API; the UI reports a generic unsuccessful outcome honestly.
- Connection Accept/Reject lacks request IDs/atomic compare-and-decide behavior.
  Frontend revalidation and duplicate guards reduce mistakes but cannot remove
  races between independent clients.
- No receiver folder-scan permission prompt existed in the original protocol.
  Folder preview requests destination metadata; sender confirmation and receiver
  per-file approvals remain the existing permission model.
- Recovery is regular-file-only. Retained sender sources consume disk space;
  automated cleanup of existing data is outside this release.
