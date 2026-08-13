const requestBox = document.getElementById("connectionRequest");

const requestMessage = document.getElementById("requestMessage");

const acceptButton = document.getElementById("acceptButton");

const rejectButton = document.getElementById("rejectButton");

const statusText = document.getElementById("status");

const deviceList = document.getElementById("deviceList");

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

// Accept connection
acceptButton.addEventListener("click", async () => {

    await fetch("/api/connection/accept", {
        method: "POST"
    });

    requestBox.classList.add("hidden");

    statusText.textContent =
        "Connection accepted";

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
loadDevices();