
(() => {
    const $ = id => document.getElementById(id);

    const button = $("phase43PreviewButton");
    const panel = $("phase43Panel");
    const files = $("phase43Files");
    const counts = $("phase43Counts");
    const status = $("folderSyncStatus");

    let previewId = null;
    let comparison = null;
    let loading = false;
    let peerConnected = false;
    let peerIp = null;
    let submitting = false;
    let epoch = 0;
    let previewPaths = null;

    function updateButtons() {
        button.disabled = !peerConnected || loading || submitting;
        for (const id of ["phase43Whole", "phase43Selected"]) {
            $(id).disabled = !peerConnected || !comparison || loading || submitting;
        }
    }

    function invalidatePreview(message) {
        const hadPreview = previewId || loading || comparison;
        epoch++;
        previewId = null;
        comparison = null;
        previewPaths = null;
        loading = false;
        panel.style.display = "none";
        if (hadPreview) status.textContent = message;
        updateButtons();
    }

    window.phase43SetConnected = (connected, nextPeerIp = null) => {
        const changedPeer = peerConnected && connected && peerIp !== nextPeerIp;
        peerConnected = connected;
        peerIp = nextPeerIp;
        if (!connected || changedPeer) invalidatePreview("Connection changed. Preview again before confirming a sync.");
        updateButtons();
    };

    for (const id of ["sourceFolderPath", "destinationFolderPath"]) {
        $(id).addEventListener("input", () => invalidatePreview("Folder paths changed. Preview again before confirming."));
    }
    updateButtons();

    async function request(url, body) {
        const r = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const d = await r.json();

        if (!r.ok || d.success === false) {
            throw Error(
                d.message || "Request failed"
            );
        }

        return d;
    }

    button.addEventListener("click", async () => {
        if (!peerConnected || loading || submitting) return;

        loading = true;
        updateButtons();
        const requestEpoch = ++epoch;
        panel.style.display = "none";

        previewId = null;
        comparison = null;

        try {
            const sourcePath =
                $("sourceFolderPath").value.trim();

            const destinationPath =
                $("destinationFolderPath").value.trim();
            if (!sourcePath || !destinationPath) throw Error("Enter both folder paths before previewing.");
            previewPaths = [sourcePath, destinationPath];

            const d = await request(
                "/api/sync/preview",
                {
                    sourcePath,
                    destinationPath
                }
            );
            if (requestEpoch !== epoch) return;

            previewId = d.previewId;

            status.textContent =
                "Waiting for peer folder comparison...";
        } catch (e) {
            if (requestEpoch !== epoch) return;
            status.textContent = e.message;
            loading = false;
            updateButtons();
        }
    });

    function render() {
        panel.style.display = "block";
        files.replaceChildren();

        const sections = [
            ["NEW", comparison.newFiles],
            ["MODIFIED", comparison.modifiedFiles],
            ["UNCHANGED", comparison.unchangedFiles]
        ];

        counts.textContent = sections
            .map(
                ([name, arr]) =>
                    name + ": " + arr.length
            )
            .join(" | ");

        for (const [name, arr] of sections) {
            for (const f of arr) {
                const label =
                    document.createElement("label");

                label.className = "sync-file";

                const input =
                    document.createElement("input");

                input.type = "checkbox";
                input.className = "phase43-check";
                input.value = f.relativePath;

                input.disabled =
                    name === "UNCHANGED";

                input.checked =
                    name !== "UNCHANGED";

                label.append(
                    input,
                    document.createTextNode(
                        " " +
                        name +
                        " — " +
                        f.relativePath +
                        " (" +
                        f.size +
                        " bytes)"
                    )
                );

                files.append(label);
            }
        }

        status.textContent =
            "Preview ready. No files have been " +
            "transferred. Choose a confirmation button.";
        updateButtons();
    }

    async function confirm(mode) {
        if (!peerConnected || !previewId || !comparison || loading || submitting) return;
        const paths = [$("sourceFolderPath").value.trim(), $("destinationFolderPath").value.trim()];
        if (!previewPaths || paths.some((value, index) => value !== previewPaths[index])) {
            invalidatePreview("Folder paths changed. Preview again before confirming.");
            return;
        }

        const selectedPaths = [
            ...document.querySelectorAll(
                ".phase43-check:checked"
            )
        ].map(el => el.value);
        const count = mode === "whole" ? comparison.newFiles.length + comparison.modifiedFiles.length : selectedPaths.length;
        if (!count) { status.textContent = "Choose at least one new or modified file to sync."; return; }

        const message =
            mode === "whole"
                ? "Sync ALL " + count + " new and modified files to " + paths[1] + " on " + (peerIp || "the connected peer") + "?"
                : "Sync " +
                  selectedPaths.length +
                  " selected files to " + paths[1] + " on " + (peerIp || "the connected peer") + "?";

        if (!window.confirm(message)) return;
        submitting = true;
        updateButtons();

        try {
            const d = await request(
                "/api/sync/confirm",
                {
                    previewId,
                    mode,
                    selectedPaths
                }
            );

            status.textContent =
                "Queued " +
                d.queued +
                " of " +
                d.requested +
                " files. Completion requires " +
                "receiver SHA-256 confirmation.";

            panel.style.display = "none";

            previewId = null;
            comparison = null;

            refreshHistory();
        } catch (e) {
            status.textContent = e.message;
        } finally {
            submitting = false;
            updateButtons();
        }
    }

    $("phase43Whole").addEventListener(
        "click",
        () => confirm("whole")
    );

    $("phase43Selected").addEventListener(
        "click",
        () => confirm("selective")
    );

    async function refreshHistory() {
        try {
            const r = await fetch(
                "/api/sync/history"
            );

            const d = await r.json();
            const target = $("phase43History");

            target.replaceChildren();

            if (!d.entries.length) {
                const empty = document.createElement("p");
                empty.className = "empty-state";
                empty.textContent = "No folder syncs yet. Start with a preview above.";
                target.append(empty);
            }

            for (const entry of d.entries.slice(0, 12)) {
                const div =
                    document.createElement("div");

                div.className = "history-item";

                div.textContent =
                    new Date(entry.at)
                        .toLocaleString() +
                    " | " +
                    (entry.mode || entry.type) +
                    " | " +
                    entry.status +
                    " | " +
                    (entry.verifiedFiles || []).length +
                    "/" +
                    (entry.selectedFiles || []).length +
                    " verified";

                target.append(div);
            }
        } catch (e) {
            console.warn(
                "History unavailable",
                e
            );
        }
    }

    async function poll() {
        const pollEpoch = epoch;
        try {
            if (previewId && loading) {
                const requestEpoch = epoch;
                const r = await fetch(
                    "/api/sync/preview-status"
                );

                const d = await r.json();
                if (requestEpoch !== epoch) return;
                if (!r.ok) throw Error(d.message || "Folder comparison unavailable");

                if (
                    d.previewId === previewId &&
                    d.ready
                ) {
                    comparison = d.comparison;
                    loading = false;
                    updateButtons();

                    render();
                } else if (d.error) {
                    loading = false;
                    updateButtons();
                    status.textContent = d.error;
                }
            }
        } catch (e) {
            if (pollEpoch === epoch) {
                loading = false;
                previewId = null;
                comparison = null;
                previewPaths = null;
                status.textContent = "Folder preview failed: " + e.message + ". Preview again before confirming.";
                updateButtons();
            }
        }

        refreshHistory();
    }

    setInterval(poll, 1500);
    refreshHistory();
})();
