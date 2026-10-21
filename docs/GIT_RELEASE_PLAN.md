# SyncLAN commit, push and PC2 preparation plan

## Approval and current state

Prepared 2026-10-22. No files have been staged, committed or pushed by this
preparation. Do not execute the mutation steps below without the user's separate
approval. Publishing code does not approve PC2 changes, service actions, live
connections/transfers or recovery of protected data.

- Local branch: `phase44b-development`, currently at
  `887336d` (verified checkpoint reader).
- Remote `origin`: `https://github.com/SwarShah2217/MINI-PROJECT`.
- Read-only remote inspection found `main`, `phase42-development` and
  `phase44-development`; no remote `phase44b-development` exists yet.
- Proposed destination: **`origin/phase44b-development`**, a new branch. Do not
  push to `main` or change another development branch.
- Current branch has no upstream. Index was empty during preparation.
- Pending backend recovery/finalization/status API changes are included because
  the new frontend uses them. The latest discovery restoration itself preserved
  the existing backend contract and wire protocol.

## Exact staging allowlist: 26 files

The following is a proposed command, **not executed**. Use literal paths only;
never stage a whole directory or run `git add .`/`git add -A`.

```powershell
$stageFiles = @(
    '.gitignore'
    'README.md'
    'DISCOVERY_APPROVAL_AUDIT.md'
    'backend/package.json'
    'backend/src/connection/connectionManager.js'
    'backend/src/connection/tcpServer.js'
    'backend/src/transfer/fileReceiver.js'
    'backend/src/transfer/fileTransferServer.js'
    'backend/src/transfer/transferManager.js'
    'backend/src/web/webServer.js'
    'backend/test/helpers.js'
    'backend/test/legacy-regression.test.js'
    'backend/test/receiver-lifecycle.test.js'
    'backend/test/sender-recovery.test.js'
    'backend/test/transfer-integration.test.js'
    'backend/test/ui-behavior.test.js'
    'backend/test/web-ui.test.js'
    'docs/GIT_RELEASE_PLAN.md'
    'docs/VALIDATION.md'
    'frontend/index.html'
    'frontend/phase42.js'
    'frontend/phase43.js'
    'frontend/phase45.js'
    'frontend/script.js'
    'frontend/style.css'
    'frontend/test/desktop-ui.test.js'
)

# Only after explicit staging/commit approval, from the repository root:
$alreadyStaged = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing index' }
if ($alreadyStaged.Count -ne 0) { throw 'Index is no longer empty; stop for review' }
git add -- $stageFiles
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; inspect before continuing' }
$staged = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect index' }
if (Compare-Object ($stageFiles | Sort-Object) ($staged | Sort-Object)) {
    throw 'Staged paths differ from approved allowlist; stop without committing'
}
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged whitespace check failed' }
git diff --cached --stat
git diff --cached --no-ext-diff --no-textconv
```

Inspect the staged content after approval and stop if anything unexpected is
already in the index, has changed since review, or matches an excluded category.
Do not unstage or overwrite someone else's staged work automatically.
`resumeCheckpoint.js` and `backend/package-lock.json` are already tracked and
unchanged; their existing versions travel with the branch and need no staging.
No dependency versions were changed. The package script now runs both suites.

## Proposed commit

Subject:

```text
feat: add desktop UI, restore discovery approvals and harden recovery
```

Body:

```text
Add seven-view navigation, light/dark themes, progress, speed/ETA and
optional notifications while preserving existing feature APIs.

Restore visible nearby-device requests and global connection/file approvals;
guard duplicate/stale actions and invalidate stale folder-sync confirmation.

Finish receiver finalization locking and explicit verified recovery; retain
sender sources and protect existing regular-file destinations.

Add 49 simulated regression tests, portable validation/release guidance and
ignore rules for runtime data, safety backups and local artifacts.

Validation: 49 tests pass; 36 JavaScript syntax checks and diff check pass.
Live two-PC, Windows disk/network, visual and OS notification checks pending.
```

After explicit commit approval, use the subject above for `git commit` and the
reviewed body via a message file if needed. Do not use a blanket `-a` commit.
Record the resulting full commit SHA; it cannot be known before committing.

Before an approved push, recheck status, commit contents and `git ls-remote
--heads origin`. If the proposed branch now exists or anything changed, stop
and review rather than overwriting it. Push only the approved commit:

```powershell
# Only after explicit push approval and verification that HEAD is the approved SHA:
git push --set-upstream origin HEAD:refs/heads/phase44b-development
```

Use a normal push; never force, mirror or push all branches. If rejected, stop
and inspect. A successful push publishes code but does not update either
running backend.

## Explicit exclusions

These files remain on disk and outside the commit:

- All `backend/downloads/`, `backend/temp/`, `backend/data/` and `.checkpoints/`
  contents, including the protected original/partial/checkpoint.
- `.phase44b-resume-safety/`, all current `.phase*-backup-*/` safety/development
  backups and `*.bak` files.
- `node_modules/`, generated test reports/coverage/logs, existing temporary
  fixture directories and one-off update/review scripts/diffs.
- `.env*` except deliberately reviewed example/sample files; private-key and
  credential containers; `.aws/`, `.ssh/`, `.codex/`, `.agents/`; OS artifacts.
- Machine-specific local handoff/incident files: `DEVELOPMENT_LOG.md`,
  `project_status.md`, `agents.md`, `PC2_READ_ONLY_INSPECTION.ps1`,
  `UI_TEST_GUIDE.md` and root `VALIDATION.md`. Their portable guidance is in
  README, the discovery audit and `docs/`.

Ignore rules are defense in depth, not proof a secret can never appear in source.
Review the exact allowlist/content before committing. Never force-add ignored
files. No protected file contents are needed for Git preparation.

## PC2: preserve the current checkout and prepare an isolated update

**Procedure only. Do not run on PC2 until PC2 inspection/update is separately
approved.** No commands here apply/pop/drop/create a stash or alter the existing
branch. Do not copy an entire repository/runtime folder between PCs.

### 1. Read-only inventory first

In PC2 PowerShell, replace the path with its actual existing repository. Inspect
status, branch, stash inventory, relevant diffs and existing Node processes; do
not assume the historical PC2 branch or path remains current.

```powershell
$pc2Repo = 'C:\path\to\existing\MINI-PROJECT'
git --no-optional-locks -C $pc2Repo -c core.fsmonitor=false status --short
git -C $pc2Repo branch --show-current
git -C $pc2Repo rev-parse HEAD
git -C $pc2Repo stash list
git -C $pc2Repo remote -v
git --no-optional-locks -C $pc2Repo diff --no-ext-diff --no-textconv --stat
git --no-optional-locks -C $pc2Repo diff --cached --no-ext-diff --no-textconv --stat
node --version
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Select-Object ProcessId, ParentProcessId, CommandLine
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 3000, 5000, 5001 } |
    Select-Object LocalAddress, LocalPort, OwningProcess
Get-NetUDPEndpoint -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq 41234 } |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

Stop on unexpected repository identity, errors or conflicting processes. Review
the output locally before sharing; remote URLs/command lines can contain private
information. Leave all runtime files and backups untouched. Source-hash checking
for the protected recovery is a later read-only gate, before that recovery test.

### 2. After PC2 update approval, fetch only the release branch

Record snapshots in this PowerShell session. Substitute the approved full SHA
from PC1 **after** its approved commit and push. Do not substitute the current
uncommitted HEAD, a guessed SHA or a moving branch name.

```powershell
$approvedCommit = '<approved-40-character-commit-sha>'
if ($approvedCommit -notmatch '^[0-9a-f]{40}$') { throw 'Set the approved commit SHA first' }
$branchBefore = git -C $pc2Repo rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read current branch' }
$headBefore = git -C $pc2Repo rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read current HEAD' }
$statusBefore = @(git --no-optional-locks -C $pc2Repo -c core.fsmonitor=false status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read current status' }
$stashBefore = @(git -C $pc2Repo stash list --format='%H %gd %gs')
if ($LASTEXITCODE -ne 0) { throw 'Cannot read stash inventory' }

# Verify origin is the reviewed repository before running this fetch.
git -C $pc2Repo fetch --no-tags --no-recurse-submodules origin refs/heads/phase44b-development:refs/remotes/origin/phase44b-development
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; stop without modifying the checkout' }
$fetchedCommit = git -C $pc2Repo rev-parse refs/remotes/origin/phase44b-development
if ($LASTEXITCODE -ne 0 -or $fetchedCommit -ne $approvedCommit) {
    throw 'Remote tip differs from the approved SHA; stop for review'
}
```

Fetch changes Git object/remote-tracking metadata only. Do not run `pull`,
`reset`, `clean`, `checkout`, `switch`, `merge` or `rebase` in the existing PC2
working directory to bypass local changes.

### 3. Create a new detached worktree, leaving the original in place

```powershell
$candidate = Join-Path (Split-Path -Parent $pc2Repo) ('SyncLAN-review-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $candidate) { throw 'Candidate path already exists; stop' }
git -C $pc2Repo worktree add --detach $candidate $approvedCommit
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed; inspect without deleting anything' }

$branchAfter = git -C $pc2Repo rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify original branch' }
$headAfter = git -C $pc2Repo rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify original HEAD' }
$statusAfter = @(git --no-optional-locks -C $pc2Repo -c core.fsmonitor=false status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify original status' }
$stashAfter = @(git -C $pc2Repo stash list --format='%H %gd %gs')
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify stash inventory' }
if ($branchAfter -ne $branchBefore -or $headAfter -ne $headBefore -or
    (($statusAfter -join "`n") -cne ($statusBefore -join "`n")) -or
    (($stashAfter -join "`n") -cne ($stashBefore -join "`n"))) {
    throw 'Original checkout/stash state changed; stop and investigate'
}

Push-Location (Join-Path $candidate 'backend')
try {
    npm.cmd ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
    npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Candidate regression tests failed' }
} finally {
    Pop-Location
}
```

Only the new checkout gets dependency files. Existing untracked/ignored runtime
data and safety backups are neither copied nor moved. No stash is changed and
the existing backend remains running from its original path. The before/after
check is Git inventory verification, not a claim to hash all user data.

### 4. Stop before runtime activation

The isolated checkout is a verified candidate, **not an activated deployment**.
Do not run `npm start` alongside the existing backend, copy old runtime data,
change startup paths, stop services or initiate any connection/transfer yet.
Request separate approval for the precise activation strategy after confirming
there are no active transfers and reviewing the original PC2 source/runtime
requirements. Recovery of an old transfer cannot be tested from an empty new
worktree without a separately reviewed data/path strategy.

If the original checkout must eventually be updated in place, first review its
actual local changes against this commit and obtain an explicit reconciliation
plan. Preserve its branch/stash/worktree rather than automatically stashing or
replacing files. Keep both checkouts on failure; do not delete them as cleanup.
Follow [fresh-fixture validation](VALIDATION.md) before any protected recovery.

## Final local results

- Node 22.19.0, npm 10.9.3.
- `npm.cmd test` from `backend`: **49 passed, 0 failed**.
- `node --check`: **36 JavaScript files passed**.
- `git diff --check`: passed; existing Windows LF/CRLF conversion notices do not
  indicate whitespace errors. No global Git/line-ending configuration changed.
- All 26 allowlisted paths exist and are not ignored. Ignore checks cover runtime
  state, each current backup category, dependencies, credential examples and
  local-only notes/scripts. No protected/runtime path is currently tracked.
- Candidate content scan found no likely credential or private incident values.
  Generic `C:\Users\You` / `C:\Users\Peer` UI placeholders were reviewed as
  examples, not actual machine paths. This is a pattern scan, not a full security
  audit. Review staged content again before publishing.
- Protected runtime data, PC2 and running services were not accessed or modified
  by these checks. Browser and two-PC validation remain pending.
