(() => {
    // Navigation changes visibility only. It never creates connections or starts
    // transfers; the existing feature handlers continue polling across views.
    if (!document.querySelectorAll || !document.getElementById("appShell")) return;
    const titles = { dashboard: "Dashboard", devices: "Nearby Devices", transfers: "File Transfers", chat: "LAN Chat",
        sync: "Folder Sync", pairing: "Device Pairing", settings: "Settings" };
    const views = [...document.querySelectorAll(".app-view")];
    const links = [...document.querySelectorAll("[data-view]")];
    const put = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    function showView(requested, focus = false) {
        const view = Object.hasOwn(titles, requested) ? requested : "dashboard";
        for (const panel of views) panel.hidden = panel.id !== "view-" + view;
        for (const link of links) {
            if (link.closest("nav")) {
                if (link.dataset.view === view) link.setAttribute("aria-current", "page");
                else link.removeAttribute("aria-current");
            }
        }
        put("viewTitle", titles[view]);
        put("viewBreadcrumb", view === "dashboard" ? "OVERVIEW" : titles[view].toUpperCase());
        document.title = "SyncLAN · " + titles[view];
        try { localStorage.setItem("synclan-view", view); } catch {}
        if (focus) {
            document.getElementById("viewTitle").focus({ preventScroll: true });
            window.scrollTo?.({ top: 0, behavior: "auto" });
        }
        if (view === "chat") {
            const messages = document.getElementById("phase42Messages");
            messages.scrollTop = messages.scrollHeight;
        }
    }
    for (const link of links) link.addEventListener("click", event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const view = link.dataset.view;
        if (window.location.hash !== "#" + view) window.history.pushState(null, "", "#" + view);
        showView(view, true);
    });
    window.addEventListener("hashchange", () => showView(window.location.hash.slice(1)));
    let savedView;
    try { savedView = localStorage.getItem("synclan-view"); } catch {}
    showView(window.location.hash.slice(1) || savedView || "dashboard");
    put("localWorkspace", window.location.host);

    let devices = [];
    let connection = { status: "disconnected", connected: false };
    function updateConnection() {
        const connected = connection.status === "connected" && connection.connected === true;
        const peer = devices.find(device => device.ip === connection.peerIp);
        const peerName = connected ? (peer?.deviceName || connection.peerIp) :
            ({ connecting: "Connecting…", pending: "Approval needed", unavailable: "Status unavailable" }[connection.status] || "Not connected");
        document.documentElement.dataset.connection = connection.status;
        if (connection.status === "unavailable") put("status", "Local backend unavailable");
        put("dashboardPeer", peerName);
        put("dashboardConnectionDetail", connected ? connection.peerIp :
            connection.status === "unavailable" ? "Check that the local backend is running" : "Pair a device or connect from the list below");
        put("sidebarConnection", connected ? "Peer connected" : peerName);
        put("chatPeer", connected ? peerName : "LAN Chat");
        put("chatConnection", connected ? "Connected · " + connection.peerIp : "Connect a device to start chatting.");
        for (const id of ["phase42Input", "phase42Send", "phase42Attach", "phase42Drop"]) {
            const control = document.getElementById(id);
            if (control) control.disabled = !connected;
        }
    }
    window.syncUI = {
        setConnection(state) { connection = state; updateConnection(); },
        setDevices(found) {
            devices = found;
            const count = found.length + (found.length === 1 ? " device" : " devices");
            put("deviceCount", count);
            put("dashboardDeviceCount", count);
            updateConnection();
        },
        setTransfer(data) {
            const labels = { transferring: "Sending", paused: "Paused", pending: "Awaiting approval", verifying: "Verifying", queued: "Queued", idle: "Idle" };
            put("dashboardQueue", data.queueLength + (data.queueLength === 1 ? " file waiting" : " files waiting"));
            put("dashboardTransfer", data.isPending ? (labels[data.status] || data.status) + " · " + data.fileName : "No outgoing transfer");
            put("transferState", labels[data.status] || data.status);
            const empty = document.getElementById("transferEmpty");
            if (empty) empty.hidden = data.isPending || !!data.lastTransfer || !!data.incoming;
        },
        transferUnavailable() {
            put("dashboardQueue", "Unavailable");
            put("dashboardTransfer", "Waiting for the local backend");
        }
    };
})();

(() => {
    const $ = id => document.getElementById(id);
    const themeButton = $("themeToggle");
    function setTheme(dark) {
        document.documentElement.dataset.theme = dark ? "dark" : "light";
        themeButton.setAttribute("aria-pressed", String(dark));
        themeButton.textContent = dark ? "Light mode" : "Dark mode";
        try { localStorage.setItem("synclan-theme", dark ? "dark" : "light"); } catch {}
    }
    let savedTheme;
    try { savedTheme = localStorage.getItem("synclan-theme"); } catch {}
    setTheme(savedTheme ? savedTheme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    themeButton.onclick = () => setTheme(document.documentElement.dataset.theme !== "dark");

    const notificationButton = $("enableNotifications");
    notificationButton.disabled = !("Notification" in window);
    notificationButton.onclick = async () => {
        try {
            const permission = await Notification.requestPermission();
            $("notificationStatus").textContent = permission === "granted"
                ? "Desktop notifications enabled." : "Desktop notifications are disabled; status remains visible here.";
        } catch {
            $("notificationStatus").textContent = "Desktop notifications unavailable in this browser.";
        }
    };
    function notify(message) {
        if ("Notification" in window && Notification.permission === "granted") {
            try { new Notification("SyncLAN", { body: message }); } catch {}
        }
    }
    const mib = bytes => (Math.max(0, bytes) / 1048576).toFixed(2) + " MiB";
    function metrics(speed, eta) {
        return speed > 0 ? `${mib(speed)}/s · ETA ${Number.isFinite(eta) ? Math.ceil(eta) + "s" : "calculating..."}`
            : "Speed and ETA appear while data is moving.";
    }

    let outgoingSeen = null;
    let incomingSeen = null;
    let initialized = false;
    const outcomes = {
        completed: "Verified complete", interrupted: "Interrupted; recovery data retained",
        cancelled: "Cancelled; recovery data retained", rejected: "Rejected by peer",
        integrity_failed: "Integrity verification failed; data retained"
    };
    async function poll() {
        try {
            const response = await fetch("/api/transfer/out-status", { cache: "no-store" });
            if (!response.ok) throw Error("Status unavailable");
            const data = await response.json();
            if (window.syncUI) window.syncUI.setTransfer(data);
            $("transferMetrics").textContent = data.status === "verifying"
                ? "All chunks received. Verifying the complete file SHA-256..."
                : data.status === "paused" ? "Paused" : metrics(data.bytesPerSecond, data.etaSeconds);
            $("transferQueue").textContent = `${data.queueLength} file(s) waiting in queue`;
            const percent = data.totalBytes ? Math.min(100, data.sentBytes / data.totalBytes * 100) : 0;
            $("outgoingProgress").setAttribute("aria-valuenow", String(Math.floor(percent)));

            const result = data.lastTransfer;
            if (result) {
                const key = result.transferId + ":" + result.at;
                const message = `${outcomes[result.status] || result.status}: ${result.fileName}`;
                $("transferResult").textContent = message;
                if (initialized && key !== outgoingSeen) notify(message);
                outgoingSeen = key;
            }
            const incoming = data.incoming;
            if (incoming) {
                const message = outcomes[incoming.status] || (incoming.status === "verifying" ? "Verifying SHA-256" : "Receiving");
                $("incomingProgress").textContent = `${message}: ${incoming.fileName} · ${mib(incoming.receivedBytes)} / ${mib(incoming.totalBytes)}` +
                    (incoming.status === "receiving" ? " · " + metrics(incoming.bytesPerSecond, incoming.etaSeconds) : "");
                const key = incoming.transferId + ":" + incoming.status + ":" + incoming.at;
                if (initialized && outcomes[incoming.status] && key !== incomingSeen) notify(`${message}: ${incoming.fileName}`);
                incomingSeen = key;
            }
            initialized = true;
        } catch {
            $("transferMetrics").textContent = "Transfer status unavailable. Reconnecting...";
            const state = $("transferState");
            if (state) state.textContent = "Unavailable";
            if (window.syncUI) window.syncUI.transferUnavailable();
        } finally {
            setTimeout(poll, 1000);
        }
    }

    $("refreshRecovery").onclick = async () => {
        const button = $("refreshRecovery");
        button.disabled = true;
        try {
            const response = await fetch("/api/transfer/recovery", { cache: "no-store" });
            const data = await response.json();
            if (!response.ok) throw Error(data.error || "Cannot inspect retained sources");
            $("recoverySources").replaceChildren();
            $("recoveryStatus").textContent = data.sources.length ? "Choose a source on this sending PC." : "No retained sources on this PC. Check the sending PC.";
            for (const source of data.sources) {
                const row = document.createElement("div");
                row.className = "recovery-source";
                const label = document.createElement("p");
                label.textContent = `${source.fileName} · ${mib(source.fileSize)} · ${source.transferId}`;
                const recover = document.createElement("button");
                recover.textContent = "Request recovery";
                recover.onclick = async () => {
                    if (!window.confirm(`Request recovery of ${source.fileName}? Accept on the receiving PC to continue from its verified checkpoint.`)) return;
                    recover.disabled = true;
                    try {
                        const response = await fetch("/api/transfer/recover", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(source)
                        });
                        const result = await response.json();
                        if (!response.ok || !result.success) throw Error(result.error || "Recovery request failed");
                        $("recoveryStatus").textContent = "Recovery queued. Accept the request on the receiving PC.";
                    } catch (error) {
                        $("recoveryStatus").textContent = error.message;
                        recover.disabled = false;
                    }
                };
                row.append(label, recover);
                $("recoverySources").append(row);
            }
        } catch (error) {
            $("recoveryStatus").textContent = error.message;
        } finally { button.disabled = false; }
    };
    poll();
})();
