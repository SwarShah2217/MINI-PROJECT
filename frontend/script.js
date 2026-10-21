const requestBox =
    document.getElementById("connectionRequest");

const requestMessage =
    document.getElementById("requestMessage");

const acceptButton =
    document.getElementById("acceptButton");

const rejectButton =
    document.getElementById("rejectButton");

const statusText =
    document.getElementById("status");

const deviceList =
    document.getElementById("deviceList");

const fileInput =
    document.getElementById("fileInput");

const sendFileButton =
    document.getElementById("sendFileButton");

const selectedFile =
    document.getElementById("selectedFile");

const fileRequestBox =
    document.getElementById("fileRequestBox");

const fileRequestMessage =
    document.getElementById("fileRequestMessage");

const acceptFileButton =
    document.getElementById("acceptFileButton");

const rejectFileButton =
    document.getElementById("rejectFileButton");

const transferControls =
    document.getElementById("transferControls");

const transferFileName =
    document.getElementById("transferFileName");

const progressBar =
    document.getElementById("progressBar");

const progressText =
    document.getElementById("progressText");

const pauseButton =
    document.getElementById("pauseButton");

const resumeButton =
    document.getElementById("resumeButton");

const cancelButton =
    document.getElementById("cancelButton");

let isCancelled = false;
let previousDeviceListKey = null;
let discoveredDevices = [];
let discoveryAvailable = false;
let connectionRequestInFlight = false;
let outgoingConnectionAttempt = null;
let connectionEpoch = 0;
let connectionStatusRequest = 0;
const pendingApprovals = { connection: null, file: null };
const approvalBusy = { connection: false, file: false };

function uiMessage(id, message) {
    const element = document.getElementById(id);
    if (element && element.textContent !== message) element.textContent = message;
}

async function readApi(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || result.message || "The local backend could not complete this request.");
    return result;
}

function validDeviceIp(ip) {
    return typeof ip === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
        ip.split(".").every(part => Number(part) <= 255) && !/^(0|127)\./.test(ip);
}

function publishConnection(state) {
    currentConnectionStatus = state;
    if (window.syncUI) window.syncUI.setConnection(state);
    renderDevices();
}

// Folder sync controls
const sourceFolderPath =
    document.getElementById(
        "sourceFolderPath"
    );

const destinationFolderPath =
    document.getElementById(
        "destinationFolderPath"
    );

const syncFolderButton =
    document.getElementById(
        "syncFolderButton"
    );

const folderSyncStatus =
    document.getElementById(
        "folderSyncStatus"
    );


// Current TCP connection state
let currentConnectionStatus = {
    status: "unavailable",
    connected: false,
    peerIp: null
};


const approvalEpoch = { connection: 0, file: 0 };
const approvalUi = {
    connection: { box: requestBox, buttons: [acceptButton, rejectButton], error: "connectionRequestError" },
    file: { box: fileRequestBox, buttons: [acceptFileButton, rejectFileButton], error: "fileRequestError" }
};

function incomingKey(kind, data) {
    if (!data?.pending) return null;
    if (kind === "connection") return validDeviceIp(data.ip) ? data.ip : null;
    if (typeof data.fileName !== "string" || !Number.isSafeInteger(data.fileSize) || data.fileSize < 0) return null;
    return data.transferId || JSON.stringify([data.fileName, data.fileSize, data.resume === true]);
}

function approvalButtons(kind) {
    for (const button of approvalUi[kind].buttons) button.disabled = approvalBusy[kind] || !pendingApprovals[kind];
}

async function refreshIncomingRequest(kind) {
    const epoch = approvalEpoch[kind];
    const ui = approvalUi[kind];
    try {
        const data = await readApi("/api/" + (kind === "connection" ? "connection" : "transfer") + "/pending");
        if (epoch !== approvalEpoch[kind]) return;
        const oldKey = incomingKey(kind, pendingApprovals[kind]);
        const key = incomingKey(kind, data);
        pendingApprovals[kind] = key ? data : null;
        if (key !== oldKey) uiMessage(ui.error, "");
        if (key) {
            ui.box.classList.remove("hidden");
            if (kind === "connection") {
                const device = discoveredDevices.find(found => found.ip === data.ip);
                uiMessage("requestMessage", (device?.deviceName ? device.deviceName + " (" + data.ip + ")" : data.ip) +
                    " wants to connect. Accept or reject this request.");
            } else {
                uiMessage("fileRequestMessage", (data.resume ? "Recovery request: " : "") + data.fileName +
                    " (" + data.fileSize + " bytes). Accept or reject before any file data is received.");
            }
        } else {
            ui.box.classList.add("hidden");
        }
    } catch (error) {
        if (epoch !== approvalEpoch[kind]) return;
        pendingApprovals[kind] = null;
        uiMessage(ui.error, "Cannot verify this request. Waiting for the local backend.");
    }
    approvalButtons(kind);
    if (kind === "connection") renderDevices();
}

async function decideIncomingRequest(kind, accept) {
    if (approvalBusy[kind] || !pendingApprovals[kind]) return;
    const captured = pendingApprovals[kind];
    const capturedKey = incomingKey(kind, captured);
    approvalBusy[kind] = true;
    approvalEpoch[kind]++;
    if (kind === "connection") connectionEpoch++;
    approvalButtons(kind);
    try {
        const prefix = "/api/" + (kind === "connection" ? "connection" : "transfer");
        const fresh = await readApi(prefix + "/pending");
        if (incomingKey(kind, fresh) !== capturedKey) {
            throw Error("This request expired or changed. Review the current request before deciding.");
        }
        const result = await readApi(prefix + (accept ? "/accept" : "/reject"), { method: "POST" });
        if (result.success !== true) throw Error(result.error || "Could not " + (accept ? "accept" : "reject") + " this request.");
        approvalEpoch[kind]++;
        pendingApprovals[kind] = null;
        approvalUi[kind].box.classList.add("hidden");
        uiMessage(approvalUi[kind].error, "");
        const outcome = (accept ? "Accepted" : "Rejected") + " incoming " +
            (kind === "connection" ? "connection request from " + captured.ip : "file request: " + captured.fileName) + ".";
        uiMessage("connectionNotice", outcome);
        if (kind === "file") uiMessage("transferResult", outcome);
        if (kind === "connection") await loadConnectionStatus();
    } catch (error) {
        uiMessage(approvalUi[kind].error, error.message);
        uiMessage("connectionNotice", error.message);
    } finally {
        approvalBusy[kind] = false;
        await refreshIncomingRequest(kind);
        approvalButtons(kind);
    }
}

async function checkPendingConnection() {
    await refreshIncomingRequest("connection");
}

// Get current TCP connection status
async function loadConnectionStatus() {
    const epoch = connectionEpoch;
    const requestNumber = ++connectionStatusRequest;

    try {

        const state = await readApi("/api/connection/status");
        if (epoch !== connectionEpoch || requestNumber !== connectionStatusRequest) return;
        if (!["connected", "connecting", "pending", "disconnected"].includes(state.status)) {
            throw Error("Invalid connection status");
        }
        if (outgoingConnectionAttempt && state.peerIp && state.peerIp !== outgoingConnectionAttempt.ip &&
            ["connected", "connecting", "pending"].includes(state.status)) {
            uiMessage("connectionNotice", "Another connection or request is active with " + state.peerIp +
                ". Your request to " + outgoingConnectionAttempt.ip + " was not confirmed.");
            outgoingConnectionAttempt = null;
        } else if (outgoingConnectionAttempt && state.status === "connected") {
            uiMessage("connectionNotice", "Connected to " + state.peerIp + ".");
            outgoingConnectionAttempt = null;
        } else if (outgoingConnectionAttempt && state.status === "disconnected" && !connectionRequestInFlight) {
            uiMessage("connectionNotice", "The request to " + outgoingConnectionAttempt.ip +
                " ended without acceptance. The peer may have rejected it or the connection failed. You can request again.");
            outgoingConnectionAttempt = null;
        } else if (currentConnectionStatus.status === "connected" && state.status === "disconnected") {
            uiMessage("connectionNotice", "Disconnected from " + currentConnectionStatus.peerIp + ".");
        }
        publishConnection(state);

        // Clear controls from the previous connection during reconnect/pending
        // states as well as after a full disconnect.
        if (currentConnectionStatus.status !== "connected") {
            fileInput.disabled = true;
            sendFileButton.disabled = true;
            sourceFolderPath.disabled = true;
            destinationFolderPath.disabled = true;
            syncFolderButton.disabled = true;
            transferControls.classList.add("hidden");
            if (window.phase43SetConnected) window.phase43SetConnected(false);
        }

        if (currentConnectionStatus.status === "connected") {

            statusText.textContent =
                `Connected to ${currentConnectionStatus.peerIp}`;

            fileInput.disabled = false;
            sendFileButton.disabled = false;

            if (fileInput.files.length === 0) {

                selectedFile.textContent =
                    "No file selected.";
            }

            sourceFolderPath.disabled = false;
            destinationFolderPath.disabled = false;
            syncFolderButton.disabled = false;
            if (window.phase43SetConnected) {
                window.phase43SetConnected(true, currentConnectionStatus.peerIp);
            }

            if (
                folderSyncStatus.textContent ===
                "Connect to a device to synchronize folders."
            ) {

                folderSyncStatus.textContent =
                    "Enter the source and destination folder paths.";
            }

            // Always check backend for active transfer status
            const res = await fetch("/api/transfer/out-status");
            const outStatus = await res.json();

            if (outStatus.isPending) {

                transferControls.classList.remove("hidden");

                transferFileName.textContent =
                    `${outStatus.status === "paused" ? "Paused" : "Transferring"}: ${outStatus.fileName}`;

                const sentMB =
                    (outStatus.sentBytes / (1024 * 1024)).toFixed(2);

                const totalMB =
                    (outStatus.totalBytes / (1024 * 1024)).toFixed(2);

                const percent =
                    outStatus.totalBytes > 0
                        ? Math.min(
                            100,
                            Math.floor(
                                (outStatus.sentBytes /
                                    outStatus.totalBytes) * 100
                            )
                        )
                        : 0;

                progressBar.style.width = `${percent}%`;

                progressText.textContent =
                    `${sentMB} MiB / ${totalMB} MiB (${percent}%)`;


                if (outStatus.status === "transferring") {

                    pauseButton.classList.remove("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.remove("hidden");

                }

                else if (outStatus.status === "paused") {

                    pauseButton.classList.add("hidden");
                    resumeButton.classList.remove("hidden");
                    cancelButton.classList.remove("hidden");

                }

                else if (outStatus.status === "pending") {

                    transferFileName.textContent =
                        `Waiting for approval: ${outStatus.fileName}`;

                    pauseButton.classList.add("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.add("hidden");

                }

                else if (outStatus.status === "queued") {

                    transferFileName.textContent =
                        `Queued: ${outStatus.fileName}`;

                    pauseButton.classList.add("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.remove("hidden");
                }
                else if (outStatus.status === "verifying") {
                    transferFileName.textContent = `Verifying: ${outStatus.fileName}`;
                    pauseButton.classList.add("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.add("hidden");
                }

            }
            else {

                transferControls.classList.add("hidden");

                progressBar.style.width = "0%";
                progressText.textContent = "0%";
            }

        }

        else if (
            currentConnectionStatus.status === "connecting"
        ) {

            statusText.textContent =
                `Connecting to ${currentConnectionStatus.peerIp}...`;

            fileInput.disabled = true;
            sendFileButton.disabled = true;

            selectedFile.textContent =
                "Waiting for connection...";
        }

        else if (
            currentConnectionStatus.status === "pending"
        ) {

            statusText.textContent =
                `Connection request from ${currentConnectionStatus.peerIp}`;

            fileInput.disabled = true;
            sendFileButton.disabled = true;

            selectedFile.textContent =
                "Accept the connection first.";
        }

        else {

            statusText.textContent =
                "Not connected";
            transferControls.classList.add("hidden");

            fileInput.disabled = true;
            sendFileButton.disabled = true;

            sourceFolderPath.disabled = true;
            destinationFolderPath.disabled = true;
            syncFolderButton.disabled = true;

            if (window.phase43SetConnected) {
                window.phase43SetConnected(false);
            }

            folderSyncStatus.textContent =
                "Connect to a device to synchronize folders.";

            selectedFile.textContent =
                "Connect to a device to select a file.";
        }



    } catch (error) {

        console.error(
            "Unable to load connection status:",
            error
        );
        if (epoch !== connectionEpoch || requestNumber !== connectionStatusRequest) return;
        publishConnection({ status: "unavailable", connected: false, peerIp: null });
        fileInput.disabled = true;
        sendFileButton.disabled = true;
        sourceFolderPath.disabled = true;
        destinationFolderPath.disabled = true;
        syncFolderButton.disabled = true;
        transferControls.classList.add("hidden");
        if (window.phase43SetConnected) window.phase43SetConnected(false);
    }
}


// Load actual devices from the existing UDP discovery registry.
async function loadDevices() {
    try {
        const devices = await readApi("/api/devices");
        if (!Array.isArray(devices)) throw Error("Invalid device discovery response");
        const seen = new Set();
        discoveredDevices = devices.filter(device => {
            if (!device || !validDeviceIp(device.ip) || seen.has(device.ip)) return false;
            seen.add(device.ip);
            return true;
        });
        discoveryAvailable = true;
        if (window.syncUI) window.syncUI.setDevices(discoveredDevices);
        renderDevices();
    } catch (error) {
        discoveryAvailable = false;
        renderDevices();
        uiMessage("devicesFeedback", "Device discovery is unavailable. Check the local backend and refresh.");
    }
}

function renderDevices() {
    const busy = connectionRequestInFlight || !!outgoingConnectionAttempt ||
        !!pendingApprovals.connection || currentConnectionStatus.status !== "disconnected";
    const key = JSON.stringify({
        devices: discoveredDevices.map(device => [device.deviceName, device.ip]),
        status: currentConnectionStatus.status, peer: currentConnectionStatus.peerIp,
        busy, discoveryAvailable, attempt: outgoingConnectionAttempt?.ip
    });
    if (key === previousDeviceListKey) return;
    previousDeviceListKey = key;
    deviceList.innerHTML = "";
    if (!discoveredDevices.length) {
        deviceList.innerHTML = '<div class="empty-state"><h3>No devices nearby yet</h3><p>Open SyncLAN on another PC on the same local network.</p></div>';
    }
    uiMessage("devicesFeedback", !discoveryAvailable ? "Checking LAN discovery…" :
        busy ? "Connection requests are paused while a connection or approval is active." :
        "Select a device and request a connection. The receiving PC must accept.");
    for (const device of discoveredDevices) {
        const row = document.createElement("div");
        row.className = "device";
        const avatar = document.createElement("span");
        avatar.className = "device-icon";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = "PC";
        const details = document.createElement("div");
        details.className = "device-details";
        const name = document.createElement("strong");
        const deviceName = typeof device.deviceName === "string" ? device.deviceName : "LAN device";
        name.textContent = deviceName;
        const address = document.createElement("p");
        address.textContent = device.ip;
        const state = document.createElement("span");
        state.className = "device-state";
        const isPeer = currentConnectionStatus.peerIp === device.ip;
        const isConnected = isPeer && currentConnectionStatus.status === "connected";
        const isConnecting = (isPeer && currentConnectionStatus.status === "connecting") ||
            outgoingConnectionAttempt?.ip === device.ip;
        const isPending = pendingApprovals.connection?.ip === device.ip ||
            (isPeer && currentConnectionStatus.status === "pending");
        const stateName = isConnected ? "connected" : isPending ? "pending" : isConnecting ? "connecting" : "disconnected";
        state.dataset.state = stateName;
        state.textContent = isConnected ? "Connected" : isPending ? "Incoming request · accept or reject above" :
            isConnecting ? "Connecting · waiting for peer approval" :
            !discoveryAvailable ? "Discovery unavailable · availability unconfirmed" : "Discovered · not connected";
        details.append(name, address, state);
        const button = document.createElement("button");
        button.className = "connectButton";
        button.textContent = isConnected ? "Connected" : isPending ? "Incoming request" :
            isConnecting ? "Request sent" : "Request Connection";
        button.disabled = busy || !discoveryAvailable;
        button.setAttribute("aria-label", button.textContent + ": " + deviceName + " (" + device.ip + ")");
        button.addEventListener("click", () => requestDeviceConnection(device.ip));
        row.append(avatar, details, button);
        deviceList.appendChild(row);
    }
}

async function requestDeviceConnection(ip) {
    if (connectionRequestInFlight || outgoingConnectionAttempt || pendingApprovals.connection ||
        currentConnectionStatus.status !== "disconnected" || !discoveryAvailable ||
        !validDeviceIp(ip) || !discoveredDevices.some(device => device.ip === ip)) return;
    connectionRequestInFlight = true;
    renderDevices();
    try {
        // Revalidate rather than trusting a possibly stale device row or tab.
        const status = await readApi("/api/connection/status");
        if (status.status !== "disconnected") {
            publishConnection(status);
            throw Error("A connection or incoming approval is already active.");
        }
        await loadDevices();
        if (!discoveryAvailable || !discoveredDevices.some(device => device.ip === ip)) {
            throw Error("This device is no longer available in LAN discovery.");
        }
        const pending = await readApi("/api/connection/pending");
        if (pending.pending) {
            await checkPendingConnection();
            throw Error("Accept or reject the incoming connection request first.");
        }
        outgoingConnectionAttempt = { ip };
        connectionEpoch++;
        uiMessage("connectionNotice", "Sending connection request to " + ip + "…");
        renderDevices();
        const result = await readApi("/api/connection/connect", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip })
        });
        if (result.success !== true) throw Error("The connection request was not accepted by the local backend.");
        uiMessage("connectionNotice", "Connection request sent to " + ip + ". Waiting for the receiving PC to accept or reject.");
    } catch (error) {
        outgoingConnectionAttempt = null;
        uiMessage("connectionNotice", error.message);
    } finally {
        connectionRequestInFlight = false;
        await loadConnectionStatus();
        renderDevices();
    }
}

document.getElementById("refreshDevices").addEventListener("click", loadDevices);

// Check incoming file approvals independently of the active sidebar view.
async function checkPendingFileRequest() {
    await refreshIncomingRequest("file");
}

// Display selected file information
fileInput.addEventListener("change", () => {
    const files = fileInput.files;

    if (files.length === 1) {
        selectedFile.textContent = `${files[0].name} (${files[0].size} bytes)`;
    } else if (files.length > 1) {
        selectedFile.textContent = `${files.length} files selected.`;
    } else {
        selectedFile.textContent = "No file selected.";
    }
});

// Upload the selected files to the local Node.js backend
sendFileButton.addEventListener("click", async () => {
    const files = Array.from(fileInput.files);

    if (files.length === 0) {
        selectedFile.textContent = "Please select a file first.";
        return;
    }

    sendFileButton.disabled = true;
    fileInput.disabled = true;

    selectedFile.textContent = `Queuing ${files.length} file(s)...`;

    transferControls.classList.remove("hidden");

    transferFileName.textContent =
        `Preparing ${files.length} file(s)...`;

    progressBar.style.width = "0%";
    progressText.textContent = "Preparing...";

    pauseButton.classList.add("hidden");
    resumeButton.classList.add("hidden");
    cancelButton.classList.add("hidden");

    for (const file of files) {
        try {
            const response = await fetch("/api/transfer/upload", {
                method: "POST",
                headers: { "X-File-Name": file.name },
                body: file
            });

            const result = await response.json();
            if (!result.success) {
                console.error(`File upload failed for ${file.name}`);
                continue;
            }

            const transferId = result.transferId;

            const transferResponse = await fetch("/api/transfer/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fileName: file.name,
                    fileSize: file.size,
                    transferId: transferId
                })
            });

            const transferResult = await transferResponse.json();
            if (!transferResult.success) {
                console.error(`Transfer request failed for ${file.name}`);
            }

        } catch (error) {
            console.error(`Error uploading ${file.name}:`, error);
        }
    }

    // Clear input so user can't click send again with same files immediately
    fileInput.value = "";
});


// Keep connection and file decisions explicit; navigation never invokes these.
acceptButton.addEventListener("click", () => decideIncomingRequest("connection", true));
rejectButton.addEventListener("click", () => decideIncomingRequest("connection", false));
acceptFileButton.addEventListener("click", () => decideIncomingRequest("file", true));
rejectFileButton.addEventListener("click", () => decideIncomingRequest("file", false));

// Check incoming requests every second
setInterval(
    checkPendingConnection,
    1000
);


// Check connection state every second
setInterval(
    loadConnectionStatus,
    1000
);


// Refresh nearby devices every two seconds
setInterval(
    loadDevices,
    2000
);



// Initial page load
checkPendingConnection();

loadConnectionStatus();

loadDevices();

// Check for incoming file requests every second
setInterval(
    checkPendingFileRequest,
    1000
);

// Check immediately when page loads
checkPendingFileRequest();

// Pause the active transfer
pauseButton.addEventListener("click", async () => {
    try {
        await fetch("/api/transfer/pause", { method: "POST" });
        // The UI will update automatically on the next polling cycle
    } catch (error) {
        console.error("Failed to pause transfer:", error);
    }
});

// Resume a paused transfer
resumeButton.addEventListener("click", async () => {
    try {
        await fetch("/api/transfer/resume", { method: "POST" });
        // The UI will update automatically on the next polling cycle
    } catch (error) {
        console.error("Failed to resume transfer:", error);
    }
});

// Cancel an active transfer
cancelButton.addEventListener("click", async () => {
    try {
        isCancelled = true;
        await fetch("/api/transfer/cancel", { method: "POST" });
    } catch (error) {
        console.error("Failed to cancel transfer:", error);
    }
});

// Start folder synchronization
syncFolderButton.addEventListener(
    "click",
    async () => {

        const sourcePath =
            sourceFolderPath.value.trim();

        const destinationPath =
            destinationFolderPath.value.trim();


        if (!sourcePath || !destinationPath) {

            folderSyncStatus.textContent =
                "Enter both folder paths.";

            return;
        }


        syncFolderButton.disabled = true;

        folderSyncStatus.textContent =
            "Comparing folders...";


        try {

            const response =
                await fetch(
                    "/api/sync/request",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            sourcePath:
                                sourcePath,

                            destinationPath:
                                destinationPath
                        })
                    }
                );


            const result =
                await response.json();


            if (!response.ok) {

                folderSyncStatus.textContent =
                    result.message ||
                    "Folder sync request failed.";

                return;
            }


            folderSyncStatus.textContent =
                "Folder sync request sent.";

        } catch (error) {

            console.error(
                "Folder sync request failed:",
                error
            );

            folderSyncStatus.textContent =
                "Folder sync request failed.";

        } finally {

            if (
                currentConnectionStatus.status ===
                "connected"
            ) {

                syncFolderButton.disabled =
                    false;
            }
        }
    }
);

// Load folder synchronization status
async function loadFolderSyncStatus() {

    try {

        const response =
            await fetch(
                "/api/sync/status"
            );

        const data =
            await response.json();


        if (!data.ready) {
            return;
        }


        const comparison =
            data.comparison;


        if (!comparison) {
            return;
        }


        folderSyncStatus.textContent =
            `Preview ready — ` +
            `New: ${comparison.newFiles.length}, ` +
            `Modified: ${comparison.modifiedFiles.length}, ` +
            `Unchanged: ${comparison.unchangedFiles.length}`;

    } catch (error) {

        console.error(
            "Unable to load folder sync status:",
            error
        );
    }
}

// Check folder sync status every second
setInterval(
    loadFolderSyncStatus,
    1000
);

// Check folder sync status on page load
loadFolderSyncStatus();
