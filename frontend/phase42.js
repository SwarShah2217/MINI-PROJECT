
(() => {
    const style = document.createElement("style");
    style.textContent = `
        #phase42Panel {
            max-width: 760px;
            margin: 24px auto;
            padding: 18px;
            border: 1px solid #aaa;
            border-radius: 12px;
            background: #f7f8fa;
            color: #202124;
        }
        #phase42Panel h2 { margin-top: 0; }
        #phase42Messages, #phase42Activity {
            height: 170px;
            overflow-y: auto;
            padding: 10px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            margin: 10px 0;
        }
        #phase42Panel .p42row {
            display: flex;
            gap: 8px;
            margin: 10px 0;
            flex-wrap: wrap;
        }
        #phase42Input {
            flex: 1;
            min-width: 170px;
            padding: 8px;
        }
        #phase42Drop {
            border: 2px dashed #888;
            border-radius: 8px;
            padding: 22px;
            text-align: center;
            cursor: pointer;
        }
        #phase42Drop.dragging {
            border-color: #1976d2;
            background: #dceeff;
        }
        #phase42Panel .p42item {
            padding: 5px;
            border-bottom: 1px solid #eee;
            overflow-wrap: anywhere;
        }
        #phase42Feedback { font-size: 13px; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "phase42Panel";
    panel.innerHTML = `
        <h2>LAN Chat</h2>
        <div id="phase42Messages" aria-live="polite"></div>
        <div class="p42row">
            <input id="phase42Input" placeholder="Type a message..." maxlength="2000">
            <button id="phase42Send">Send</button>
            <button id="phase42Attach">Share File</button>
        </div>
        <div id="phase42Drop">Drop files here to transfer</div>
        <p id="phase42Feedback"></p>
        <h2>Transfer Activity</h2>
        <div id="phase42Activity"></div>
    `;

    document.body.appendChild(panel);

    const messages = document.getElementById("phase42Messages");
    const activity = document.getElementById("phase42Activity");
    const input = document.getElementById("phase42Input");
    const feedback = document.getElementById("phase42Feedback");
    const drop = document.getElementById("phase42Drop");

    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        try {
            const response = await fetch("/api/chat/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text })
            });

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || "Send failed");
            }

            input.value = "";
            feedback.textContent = "";
            await refresh();
        } catch (error) {
            feedback.textContent = error.message;
        }
    }

    document.getElementById("phase42Send")
        .addEventListener("click", sendMessage);

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") sendMessage();
    });

    async function shareFiles(files) {
        if (!files.length) return;

        const connection = await fetch("/api/connection/status")
            .then(response => response.json());

        if (!connection.connected) {
            feedback.textContent = "Connect to the other PC first.";
            return;
        }

        feedback.textContent = "Preparing " + files.length + " file(s)...";

        for (const file of files) {
            try {
                const upload = await fetch("/api/transfer/upload", {
                    method: "POST",
                    headers: { "X-File-Name": file.name },
                    body: file
                });

                const uploaded = await upload.json();
                if (!uploaded.success) throw new Error("Upload failed");

                const request = await fetch("/api/transfer/request", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        fileName: file.name,
                        fileSize: file.size,
                        transferId: uploaded.transferId
                    })
                });

                const result = await request.json();
                if (!result.success) throw new Error("Transfer request failed");

                feedback.textContent = "Queued: " + file.name +
                    " — accept on the receiving PC.";
            } catch (error) {
                feedback.textContent = file.name + ": " + error.message;
            }
        }

        await refresh();
    }

    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    panel.appendChild(picker);

    picker.addEventListener("change", () => {
        shareFiles(Array.from(picker.files)).catch(error => {
            feedback.textContent = error.message;
        });
        picker.value = "";
    });

    document.getElementById("phase42Attach")
        .addEventListener("click", () => picker.click());

    drop.addEventListener("click", () => picker.click());

    drop.addEventListener("dragover", event => {
        event.preventDefault();
        drop.classList.add("dragging");
    });

    drop.addEventListener("dragleave", () => {
        drop.classList.remove("dragging");
    });

    drop.addEventListener("drop", event => {
        event.preventDefault();
        drop.classList.remove("dragging");
        shareFiles(Array.from(event.dataTransfer.files)).catch(error => {
            feedback.textContent = error.message;
        });
    });

    let previousMessages = "";
    let previousActivity = "";

    function render(container, entries, format) {
        container.replaceChildren();

        for (const entry of entries) {
            const item = document.createElement("div");
            item.className = "p42item";
            item.textContent = format(entry);
            container.appendChild(item);
        }
    }

    async function refresh() {
        try {
            const [chatResponse, activityResponse] = await Promise.all([
                fetch("/api/chat/messages"),
                fetch("/api/activity")
            ]);

            const chat = await chatResponse.json();
            const history = await activityResponse.json();

            const chatKey = JSON.stringify(chat.messages);
            if (chatKey !== previousMessages) {
                previousMessages = chatKey;
                render(messages, chat.messages, entry =>
                    (entry.direction === "outgoing" ? "You: " : "Peer: ") +
                    entry.text
                );
                messages.scrollTop = messages.scrollHeight;
            }

            const activityKey = JSON.stringify(history.activity);
            if (activityKey !== previousActivity) {
                previousActivity = activityKey;
                render(activity, history.activity, entry =>
                    new Date(entry.timestamp).toLocaleString() +
                    " — " + entry.kind + ": " + entry.details
                );
            }
        } catch (error) {
            console.error("Phase 4.2 refresh:", error);
        }
    }

    refresh();
    setInterval(refresh, 1000);
})();
