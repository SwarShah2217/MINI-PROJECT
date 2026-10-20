
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

    window.phase43SetConnected = connected => {
        button.disabled = !connected || loading;
    };

    async function request(url, body) {
        const r = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const d = await r.json();

        if (!r.ok) {
            throw Error(
                d.message || "Request failed"
            );
        }

        return d;
    }

    button.addEventListener("click", async () => {
        if (loading) return;

        loading = true;
        button.disabled = true;
        panel.style.display = "none";

        previewId = null;
        comparison = null;

        try {
            const sourcePath =
                $("sourceFolderPath").value.trim();

            const destinationPath =
                $("destinationFolderPath").value.trim();

            const d = await request(
                "/api/sync/preview",
                {
                    sourcePath,
                    destinationPath
                }
            );

            previewId = d.previewId;

            status.textContent =
                "Waiting for peer folder comparison...";
        } catch (e) {
            status.textContent = e.message;
            loading = false;
            button.disabled = false;
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

                label.style.display = "block";

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
    }

    async function confirm(mode) {
        if (!previewId || !comparison) return;

        const selectedPaths = [
            ...document.querySelectorAll(
                ".phase43-check:checked"
            )
        ].map(el => el.value);

        const message =
            mode === "whole"
                ? "Sync ALL new and modified files?"
                : "Sync " +
                  selectedPaths.length +
                  " selected files?";

        if (!window.confirm(message)) return;

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

            for (const entry of d.entries.slice(0, 12)) {
                const div =
                    document.createElement("div");

                div.style.padding = "4px";
                div.style.borderBottom =
                    "1px solid #aaa";

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
        try {
            if (previewId && loading) {
                const r = await fetch(
                    "/api/sync/preview-status"
                );

                const d = await r.json();

                if (
                    d.previewId === previewId &&
                    d.ready
                ) {
                    comparison = d.comparison;
                    loading = false;
                    button.disabled = false;

                    render();
                } else if (d.error) {
                    loading = false;
                    button.disabled = false;
                    status.textContent = d.error;
                }
            }
        } catch (e) {
            console.warn(
                "Preview polling failed",
                e
            );
        }

        refreshHistory();
    }

    setInterval(poll, 1500);
    refreshHistory();
})();
