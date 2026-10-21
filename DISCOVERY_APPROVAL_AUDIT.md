# Device discovery and approval audit

## Findings from original HEAD and current code

- UDP discovery and `GET /api/devices` were never removed. The redesign retained
  the device list on Dashboard and the existing connect API, but omitted a Devices
  sidebar destination. The generic Connect label and limited row status obscured
  the manual request/receiver approval workflow.
- Connection/file request banners already lived outside page views. Connection
  Accept/Reject and file Reject hid banners without checking success. File Accept
  checked errors, but all decisions lacked duplicate/stale-request guards.
- Folder preview and whole/selective confirmation existed. Confirm controls could
  survive a disconnect or edited paths; concurrent confirmation was not guarded.

## Frontend restoration

- Dedicated seventh sidebar view: **Nearby Devices**, clearly linked on Dashboard.
  The real registry API supplies names and IPs; no production fixtures/mock devices.
- Device rows show discovered/disconnected, connecting, incoming-request and
  connected states. Invalid/duplicate addresses are excluded. Discovery errors mark
  availability unknown and disable requests.
- **Request Connection** is available only when eligible. The UI locks immediately,
  rechecks current connection, discovery and pending request state, then uses the
  existing `/api/connection/connect` route. Another tab's active peer is not
  misrepresented as acceptance of this tab's request.
- Connection/file requests remain sticky and visible outside every page. Accept
  and Reject revalidate the displayed pending request, disable concurrent decisions
  and show errors without silently discarding the banner. Changed/expired requests
  need a new user decision.
- Folder confirmation needs a connected peer and fresh preview; path/peer changes
  or disconnect invalidate it. The native confirmation names the destination/peer.
  Duplicate confirmation is blocked. Receiver file approvals remain explicit.
- Existing PIN/QR, backend APIs, UDP discovery and transport protocols are unchanged.

## Explicit frontend-only limits

This restoration deliberately keeps the existing backend status contract. The status API resets both peer
rejection and socket failure to disconnected, so the sender truthfully shows:
“ended without acceptance; the peer may have rejected it or the connection failed.”
Local Reject decisions are reported explicitly; no remote reason is invented.

Connection Accept/Reject endpoints always return success and accept no request ID.
Revalidation prevents stale/duplicate actions in this tab, but cannot make a
GET/POST pair atomic across independent clients. Multi-tab decisions still need
manual verification; stronger atomicity would require separate backend approval.

There was no separate receiver folder-scan permission dialog in the original
code. `FOLDER_SYNC_REQUEST` requests destination metadata for preview; the sender
confirms changes, then the receiver approves each file. The pending-file API also
omits destination metadata. No fictitious folder-wide permission UI was added.

## Checks and remaining verification

- 49 tests pass: 34 existing checks plus 15 desktop UI tests. All tested POSTs are
  simulated, with no live requests/transfers or protected data access.
- Coverage includes discovery updates/removal, duplicate requests, failed/expired
  decisions, all-seven-view banner visibility, pairing, and sync confirmation.
- Frontend syntax and `git diff --check` pass. Read-only localhost checks confirmed
  updated assets; real registry count was zero, transfer state idle, queue zero.
- No backend edits/restarts, PC2 access, protected-data reads/writes or commits.

After separate approval, manually verify actual discovery/expiry on both PCs;
request then reject/retry/accept; switch and scroll through every view while
requests wait; test duplicate clicks, unavailable peers and competing browser
tabs; verify PIN/QR separately. Valid PIN/QR follows the existing authenticated
automatic acceptance path rather than creating a manual approval prompt.

Use fresh files first for receiver Accept/Reject, content/hash verification and
whole/selective folder sync. Verify actual destinations and per-file approvals.
Detailed browser rendering, network timing and cross-client races are not covered
by the simulated DOM tests. Preserve all protected 200 MiB data and verify the
original PC2 source hash before any separately approved recovery involving it.
