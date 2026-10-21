# SyncLAN MINI-PROJECT

Node.js application for LAN file transfer, chat, folder synchronization, PIN/QR
pairing and interrupted-transfer recovery between two Windows PCs.

## Interface and capabilities

- Seven dedicated views: Dashboard, Nearby Devices, File Transfers, LAN Chat,
  Folder Sync, Device Pairing and Settings.
- Real UDP discovery, explicit connection requests and global Accept/Reject
  banners; existing authenticated PIN/QR pairing remains available.
- Encrypted, chunked file transfers with adaptive compression, receiver approval,
  acknowledged progress, speed/ETA and explicit recovery controls.
- Chat with attachments; whole-folder and selective sync after preview and
  confirmation, with existing receiver per-file approval.
- Persistent light/dark themes, responsive navigation and optional browser
  notifications.

## Setup

Local automated validation uses Node.js **22.19.0** and npm **10.9.3**; other
versions have not been validated for this release. Dependencies are locked in
`backend/package-lock.json`.

For a **new checkout**, install dependencies from `backend`:

```powershell
Set-Location backend
npm.cmd ci --ignore-scripts
```

Before starting, check whether an existing SyncLAN backend already owns its
ports. Starting the application opens LAN discovery/control/file listeners;
obtain any required operational approval first. Do not start a second instance.

```powershell
# Only after approval to start this checkout:
npm.cmd start
```

The browser UI is served at `http://127.0.0.1:3000`. Existing configuration uses
UDP 41234 for discovery, TCP 5000 for control and TCP 5001 for file data. Refresh
the browser to load frontend edits; backend code edits require an approved
restart to become active.

## Automated checks

From `backend`, `npm.cmd test` runs both backend and frontend regression suites.
From the repository root, the equivalent command is:

```powershell
node --test backend/test/*.test.js frontend/test/*.test.js
```

Tests use simulated DOMs, event-emitter sockets and in-memory transfer files.
They do not start the backend, open LAN listeners or access live transfer data.
See [validation](docs/VALIDATION.md) for coverage, limitations and the manual
fresh-file test sequence.

## Local data and release boundaries

`backend/downloads/`, `backend/temp/`, `backend/data/`, checkpoints, safety backups,
dependencies and machine-specific incident notes are excluded from Git. Retained
upload sources support explicit recovery and are not automatically removed when
a transfer completes; allow for their local disk usage. Recovery is for regular
file transfers; folder-sync resume is unsupported.

Never delete, reset, overwrite or automatically resume an existing protected
transfer. Verify its original source against its checkpoint before separately
approved recovery testing. Use fresh fixtures for initial two-PC validation.

Implementation and simulated checks are complete locally; live two-PC recovery,
Windows filesystem behavior, browser rendering and OS notification delivery
still need manual validation. See the [discovery/approval audit](DISCOVERY_APPROVAL_AUDIT.md)
and [Git release plan](docs/GIT_RELEASE_PLAN.md). No deployment or live test is
implied by the automated checks.
