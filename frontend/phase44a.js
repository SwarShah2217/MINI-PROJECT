
(() => {
    const $ = id =>
        document.getElementById(id);

    const status = text => {
        $("p44status").textContent = text;
    };

    async function post(url, data) {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw Error(
                result.error || "Request failed"
            );
        }

        return result;
    }

    // Generate a PIN and QR on this laptop.
    $("p44create").onclick = async () => {
        try {
            const result = await post(
                "/api/pairing/create",
                {}
            );

            $("p44pin").textContent = result.pin;

            $("p44qr").src = result.qr;
            $("p44qr").style.display = "block";

            $("p44ip").textContent =
                "LAN IP: " +
                result.ips.join(" / ") +
                " (QR uses " + result.ips[0] + ")";

            $("p44expiry").textContent =
                "Expires in 2 minutes; one use only.";

            status(
                "Show this code or QR to the other laptop."
            );

        } catch (error) {
            status(error.message);
        }
    };

    // Pair using the six-digit PIN.
    $("p44connect").onclick = async () => {
        try {
            const result = await post(
                "/api/pairing/connect",
                {
                    ip: $("p44host").value.trim(),
                    kind: "pin",
                    value: $("p44code").value.trim()
                }
            );

            status(
                result.message +
                " — check connection status."
            );

        } catch (error) {
            status(error.message);
        }
    };

    // Decode a QR photo entirely in the browser.
    $("p44decode").onclick = async () => {
        try {
            const file = $("p44photo").files[0];

            if (!file) {
                throw Error(
                    "Choose a QR photo first"
                );
            }

            if (!window.jsQR) {
                throw Error(
                    "QR decoder unavailable"
                );
            }

            const image =
                await createImageBitmap(file);

            const canvas =
                document.createElement("canvas");

            const scale = Math.min(
                1,
                1400 /
                Math.max(
                    image.width,
                    image.height
                )
            );

            canvas.width = Math.max(
                1,
                Math.round(image.width * scale)
            );

            canvas.height = Math.max(
                1,
                Math.round(image.height * scale)
            );

            const ctx = canvas.getContext(
                "2d",
                { willReadFrequently: true }
            );

            ctx.drawImage(
                image,
                0,
                0,
                canvas.width,
                canvas.height
            );

            const pixels = ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
            );

            const code = jsQR(
                pixels.data,
                canvas.width,
                canvas.height,
                {
                    inversionAttempts:
                        "attemptBoth"
                }
            );

            if (!code) {
                throw Error(
                    "No readable QR found; retake photo closer"
                );
            }

            const payload =
                JSON.parse(code.data);

            if (
                payload.app !== "SyncLAN" ||
                payload.version !== 1
            ) {
                throw Error(
                    "Not a SyncLAN QR"
                );
            }

            const result = await post(
                "/api/pairing/connect",
                {
                    ip: payload.ip,
                    kind: "qr",
                    value: payload.token
                }
            );

            status(
                result.message +
                " — check connection status."
            );

        } catch (error) {
            status(error.message);
        }
    };
})();
