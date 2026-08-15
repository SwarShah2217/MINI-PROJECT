const requestBox = document.getElementById("connectionRequest");

const requestMessage = document.getElementById("requestMessage");

const acceptButton = document.getElementById("acceptButton");

const rejectButton = document.getElementById("rejectButton");

const statusText = document.getElementById("status");

const deviceList = document.getElementById("deviceList");

const fileInput = document.getElementById("fileInput");

const sendFileButton = document.getElementById("sendFileButton");

const selectedFile = document.getElementById("selectedFile");

// Check whether there is an incoming connection request
async function checkPendingConnection() {

    try {

        const response = await fetch("/api/connection/pending");

        const data = await response.json();

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

// Get discovered SyncLAN devices from the backend
async function loadDevices() {

    try {

        // Get the list of discovered devices
        const response = await fetch("/api/devices");
        const devices = await response.json();

        // Clear the previous device list
        deviceList.innerHTML = "";

        // Show a message if no devices are available
        if (devices.length === 0) {
            deviceList.innerHTML = "<p>No devices found.</p>";
            return;
        }

        // Display every discovered device
        devices.forEach((device) => {

            const deviceBox = document.createElement("div");
            deviceBox.className = "device";

            deviceBox.innerHTML = `
                <strong>${device.deviceName}</strong>
                <p>${device.ip}</p>
                <button class="connectButton">Connect</button>
            `;

            const connectButton = deviceBox.querySelector(".connectButton");

            connectButton.addEventListener("click", async () => {

                await fetch("/api/connection/connect", {
                    method: "POST",

                     headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        ip: device.ip
                    })
                });

                statusText.textContent = `Connecting to ${device.deviceName}...`;
            });

            deviceList.appendChild(deviceBox);
        });

    } catch (error) {

        console.error("Unable to load devices:", error);

    }
}

// Display the selected file name
fileInput.addEventListener("change", () => {

    const file = fileInput.files[0];

    if (file) {
        selectedFile.textContent =
            `${file.name} (${file.size} bytes)`;
    } else {
        selectedFile.textContent =
            "No file selected.";
    }
});

// Accept connection
acceptButton.addEventListener("click", async () => {

    await fetch("/api/connection/accept", {
        method: "POST"
    });

    requestBox.classList.add("hidden");

    statusText.textContent =
        "Connection accepted";

     // Enable file sending after connection is accepted
    fileInput.disabled = false;
    sendFileButton.disabled = false;

    selectedFile.textContent =
        "No file selected.";

});


// Reject connection
rejectButton.addEventListener("click", async () => {

    await fetch("/api/connection/reject", {
        method: "POST"
    });

    requestBox.classList.add("hidden");

    statusText.textContent =
        "Connection rejected";

});


// Check every second for new requests
setInterval(checkPendingConnection, 1000);

// Refresh nearby devices every 2 seconds
setInterval(loadDevices, 2000);

// Load devices immediately when the page opens
loadDevices();const requestBox =
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


        // Refresh device buttons using latest status
        loadDevices();

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