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

const transferControls = document.getElementById("transferControls");
const progressText = document.getElementById("progressText");
const pauseButton = document.getElementById("pauseButton");
const resumeButton = document.getElementById("resumeButton");
const cancelButton = document.getElementById("cancelButton");

let isCancelled = false;

// Current TCP connection state
let currentConnectionStatus = {
    status: "disconnected",
    connected: false,
    peerIp: null
};


// Check for incoming connection requests
async function checkPendingConnection() {

    try {

        const response =
            await fetch("/api/connection/pending");

        const data =
            await response.json();


        if (data.pending) {

            requestBox.classList.remove("hidden");

            requestMessage.textContent =
                `${data.ip} wants to connect.`;

        } else {

            requestBox.classList.add("hidden");
        }

    } catch (error) {

        console.error(
            "Unable to check connection request:",
            error
        );
    }
}


// Get current TCP connection status
async function loadConnectionStatus() {

    try {

        const response =
            await fetch("/api/connection/status");

        currentConnectionStatus =
            await response.json();


        if (currentConnectionStatus.status === "connected") {

            statusText.textContent =
                `Connected to ${currentConnectionStatus.peerIp}`;

            fileInput.disabled = false;
            sendFileButton.disabled = false;

            // Always check backend for active transfer status
            const res = await fetch("/api/transfer/out-status");
            const outStatus = await res.json();

            if (outStatus.isPending) {
                // Active transfer — show controls and progress
                transferControls.classList.remove("hidden");

                const sentMB = (outStatus.sentBytes / (1024 * 1024)).toFixed(2);
                const totalMB = (outStatus.totalBytes / (1024 * 1024)).toFixed(2);
                const percent = outStatus.totalBytes > 0
                    ? Math.floor((outStatus.sentBytes / outStatus.totalBytes) * 100)
                    : 0;
                progressText.textContent = `${sentMB} MB / ${totalMB} MB (${percent}%)`;

                const queueText = outStatus.queueLength > 0 ? ` (${outStatus.queueLength} more in queue)` : "";

                if (outStatus.status === "transferring") {
                    selectedFile.textContent = `Transferring: ${outStatus.fileName}${queueText}`;
                    pauseButton.classList.remove("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.remove("hidden");
                } else if (outStatus.status === "paused") {
                    selectedFile.textContent = `Paused: ${outStatus.fileName}${queueText}`;
                    pauseButton.classList.add("hidden");
                    resumeButton.classList.remove("hidden");
                    cancelButton.classList.remove("hidden");
                } else if (outStatus.status === "pending") {
                    selectedFile.textContent = `Waiting for approval: ${outStatus.fileName}${queueText}`;
                    pauseButton.classList.add("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.add("hidden");
                } else if (outStatus.status === "queued") {
                    selectedFile.textContent = `Queued: ${outStatus.fileName}${queueText}`;
                    pauseButton.classList.add("hidden");
                    resumeButton.classList.add("hidden");
                    cancelButton.classList.remove("hidden");
                }
            } else if (outStatus.queueLength > 0) {
                // Queue has items but nothing active yet
                selectedFile.textContent = `${outStatus.queueLength} file(s) queued...`;
                transferControls.classList.add("hidden");
            } else {
                // No active transfer, no queue
                transferControls.classList.add("hidden");
                if (isCancelled) {
                    selectedFile.textContent = "Transfer cancelled.";
                    isCancelled = false;
                } else if (selectedFile.textContent.includes("Transferring") ||
                           selectedFile.textContent.includes("Paused") ||
                           selectedFile.textContent.includes("Waiting for approval") ||
                           selectedFile.textContent.includes("Queued")) {
                    selectedFile.textContent = "All files transferred successfully.";
                } else if (!fileInput.files.length) {
                    selectedFile.textContent = "No file selected.";
                }
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

            fileInput.disabled = true;
            sendFileButton.disabled = true;

            selectedFile.textContent =
                "Connect to a device to select a file.";
        }



    } catch (error) {

        console.error(
            "Unable to load connection status:",
            error
        );
    }
}


// Load discovered devices
async function loadDevices() {

    try {

        const response =
            await fetch("/api/devices");

        const devices =
            await response.json();


        deviceList.innerHTML = "";


        if (devices.length === 0) {

            deviceList.innerHTML =
                "<p>No devices found.</p>";

            return;
        }


        devices.forEach((device) => {

            const deviceBox =
                document.createElement("div");

            deviceBox.className = "device";


            const isConnectedDevice =
                currentConnectionStatus.connected &&
                currentConnectionStatus.peerIp === device.ip;


            const connectionBusy =
                currentConnectionStatus.status !==
                "disconnected";


            let buttonText = "Connect";

            if (isConnectedDevice) {
                buttonText = "Connected";
            }


            deviceBox.innerHTML = `
                <strong>${device.deviceName}</strong>
                <p>${device.ip}</p>

                <button
                    class="connectButton"
                    ${connectionBusy ? "disabled" : ""}
                >
                    ${buttonText}
                </button>
            `;


            const connectButton =
                deviceBox.querySelector(".connectButton");


            connectButton.addEventListener(
                "click",
                async () => {

                    try {

                        const response =
                            await fetch(
                                "/api/connection/connect",
                                {
                                    method: "POST",

                                    headers: {
                                        "Content-Type":
                                            "application/json"
                                    },

                                    body: JSON.stringify({
                                        ip: device.ip
                                    })
                                }
                            );


                        const result =
                            await response.json();


                        if (result.success) {

                            statusText.textContent =
                                `Connecting to ${device.deviceName}...`;
                        }

                    } catch (error) {

                        console.error(
                            "Unable to connect:",
                            error
                        );
                    }
                }
            );


            deviceList.appendChild(deviceBox);
        });

    } catch (error) {

        console.error(
            "Unable to load devices:",
            error
        );
    }
}

// Check for incoming file transfer requests
async function checkPendingFileRequest() {

    try {

        const response =
            await fetch("/api/transfer/pending");

        const data =
            await response.json();


        if (data.pending) {

            fileRequestBox.classList.remove("hidden");

            fileRequestMessage.textContent =
                `${data.fileName} (${data.fileSize} bytes)`;

        } else {

            fileRequestBox.classList.add("hidden");
        }

    } catch (error) {

        console.error(
            "Unable to check file transfer request:",
            error
        );
    }
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


// Accept incoming connection
acceptButton.addEventListener(
    "click",
    async () => {

        await fetch(
            "/api/connection/accept",
            {
                method: "POST"
            }
        );

        requestBox.classList.add("hidden");
    }
);


// Reject incoming connection
rejectButton.addEventListener(
    "click",
    async () => {

        await fetch(
            "/api/connection/reject",
            {
                method: "POST"
            }
        );

        requestBox.classList.add("hidden");
    }
);

// Accept incoming file transfer
acceptFileButton.addEventListener(
    "click",
    async () => {

        await fetch(
            "/api/transfer/accept",
            {
                method: "POST"
            }
        );

        fileRequestBox.classList.add("hidden");
    }
);


// Reject incoming file transfer
rejectFileButton.addEventListener(
    "click",
    async () => {

        await fetch(
            "/api/transfer/reject",
            {
                method: "POST"
            }
        );

        fileRequestBox.classList.add("hidden");
    }
);


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