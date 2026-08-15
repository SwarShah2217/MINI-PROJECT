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

            if (!fileInput.files.length) {
                selectedFile.textContent =
                    "No file selected.";
            } else if (selectedFile.textContent.includes("Waiting for approval...") || selectedFile.textContent.includes("Transfer accepted, sending...")) {
                const res = await fetch("/api/transfer/out-status");
                const outStatus = await res.json();
                if (!outStatus.isPending) {
                    selectedFile.textContent = "File transferred successfully.";
                } else if (outStatus.status === "transferring" && !selectedFile.textContent.includes("Transfer accepted, sending...")) {
                    selectedFile.textContent = "Transfer accepted, sending...";
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

    const file =
        fileInput.files[0];


    if (file) {

        selectedFile.textContent =
            `${file.name} (${file.size} bytes)`;

    } else {

        selectedFile.textContent =
            "No file selected.";
    }
});

// Upload the selected file to the local Node.js backend
sendFileButton.addEventListener("click", async () => {

    const file = fileInput.files[0];

    if (!file) {
        selectedFile.textContent =
            "Please select a file first.";
        return;
    }

    try {

        selectedFile.textContent =
            `Uploading ${file.name}...`;

        const response = await fetch(
            "/api/transfer/upload",
            {
                method: "POST",

                headers: {
                    "X-File-Name": file.name
                },

                body: file
            }
        );

        const result =
            await response.json();

        if (!result.success) {

            selectedFile.textContent =
                "File upload failed.";

            return;
        }

        selectedFile.textContent =
            `${file.name} uploaded. Sending transfer request...`;

        console.log(
            "File uploaded successfully:",
            result
        );


        // Tell the backend to send the file transfer request
        const transferResponse = await fetch(
            "/api/transfer/request",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    fileName: file.name,
                    fileSize: file.size
                })
            }
        );

        const transferResult =
            await transferResponse.json();


        if (!transferResult.success) {

            selectedFile.textContent =
                "Could not send file transfer request.";

            console.error(
                "Transfer request failed:",
                transferResult
            );

            return;
        }


        selectedFile.textContent =
            `${file.name} transfer request sent. Waiting for approval...`;

        console.log(
            "Transfer request sent successfully:",
            transferResult
        );

    } catch (error) {

        console.error(
            "File upload error:",
            error
        );

        selectedFile.textContent =
            "File upload failed.";
    }
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