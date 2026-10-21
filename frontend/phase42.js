(() => {
    const panel = document.getElementById("phase42Panel");

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

        if (!entries.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = container === messages
                ? "No messages yet. Say hello to your connected peer."
                : "No recorded transfer activity yet.";
            container.appendChild(empty);
            return;
        }

        for (const entry of entries) {
            const item = document.createElement("div");
            if (container === messages) {
                item.className = "message " + (entry.direction === "outgoing" ? "outgoing" : "incoming");
                const bubble = document.createElement("div");
                bubble.className = "message-bubble";
                bubble.textContent = entry.text;
                const meta = document.createElement("span");
                meta.className = "message-meta";
                const date = new Date(entry.timestamp);
                meta.textContent = (entry.direction === "outgoing" ? "You" : "Peer") +
                    (Number.isNaN(date.getTime()) ? "" : " · " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
                item.append(bubble, meta);
            } else {
                item.className = "activity-item";
                item.textContent = format(entry);
            }
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
                const oldScrollTop = messages.scrollTop;
                const followLatest = previousMessages === "" ||
                    messages.scrollHeight - messages.clientHeight - oldScrollTop < 48;
                previousMessages = chatKey;
                render(messages, chat.messages, entry =>
                    (entry.direction === "outgoing" ? "You: " : "Peer: ") +
                    entry.text
                );
                messages.scrollTop = followLatest ? messages.scrollHeight : oldScrollTop;
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
