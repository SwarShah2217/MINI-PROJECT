const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const FolderScanner =
    require("../sync/folderScanner");
const SyncHistory = require("../sync/syncHistory");

class WebServer {

    constructor(tcpServer, discoveryService, connectionManager, transferManager, communicationService) {

        // Store TCP server so the webpage can access connection requests
        this.tcpServer = tcpServer;
        // Access discovered devices and create outgoing TCP connections
        this.discoveryService = discoveryService;
        this.connectionManager = connectionManager;
        this.transferManager = transferManager;

        this.communicationService = communicationService;

        this.phase43History = new SyncHistory();
        this.phase43PreviewId = null;

        transferManager.phase43History =
            this.phase43History;

        transferManager.phase43HistoryFileVerified =
            (id, rel) => {
                const entry =
                    this.phase43History.entries.find(
                        e => e.id === id
                    );

                if (!entry) return;

                const verified = [
                    ...new Set([
                        ...(entry.verifiedFiles || []),
                        rel
                    ])
                ];

                this.phase43History.update(id, {
                    verifiedFiles: verified,
                    status:
                        verified.length ===
                        entry.selectedFiles.length
                            ? "completed"
                            : "transferring"
                });
            };
// Create the local HTTP server
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });
    }


    // Start the local web interface on port 3000
    start() {

        this.server.listen(3000, "127.0.0.1", () => {
            console.log("Web interface running at http://localhost:3000");
        });
    }


    // Handle requests coming from the browser
    handleRequest(req, res) {

        // Read-only discovery of retained upload sources, including after restart.
        if (req.url === "/api/transfer/recovery" && req.method === "GET") {
            const directory = path.join(__dirname, "../../temp");
            try {
                const sources = fs.existsSync(directory) ? fs.readdirSync(directory).flatMap(name => {
                    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i.exec(name);
                    if (!match) return [];
                    const stats = fs.lstatSync(path.join(directory, name));
                    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0) return [];
                    return [{ transferId: match[1], fileName: match[2], fileSize: stats.size }];
                }) : [];
                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ sources }));
            } catch (error) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Could not inspect retained sources" }));
            }
            return;
        }

        // Recovery only starts after an explicit browser action. The peer still
        // accepts the request and verifies its checkpoint and the source hash.
        if (req.url === "/api/transfer/recover" && req.method === "POST") {
            const origin = req.headers.origin;
            if (!String(req.headers["content-type"] || "").startsWith("application/json") ||
                (origin && origin !== `http://${req.headers.host}`)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Use the local SyncLAN interface" }));
                return;
            }
            let body = "";
            let oversized = false;
            req.on("data", chunk => {
                if (oversized) return;
                body += chunk;
                if (Buffer.byteLength(body) > 4096) {
                    oversized = true;
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Request too large" }));
                }
            });
            req.on("end", () => {
                if (oversized) return;
                let data;
                try { data = JSON.parse(body); } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON" }));
                    return;
                }
                const success = data && this.transferManager.queueInterruptedTransfer(
                    data.transferId, data.fileName, data.fileSize);
                res.writeHead(success ? 200 : 409, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: !!success,
                    error: success ? undefined : "Connect to the peer and select an available, unqueued source" }));
            });
            return;
        }

        // PHASE44A_API: local-only PIN and QR pairing.

        if (
            req.url === "/api/pairing/create" &&
            req.method === "POST"
        ) {
            const os = require("os");
            const QRCode = require("qrcode");

            const interfaces = os.networkInterfaces();

            const isValidIPv4 = (name, network) => {
                return (
                    network &&
                    network.family === "IPv4" &&
                    !network.internal &&
                    !/virtualbox|vbox|vmware|hyper-v|hyperv|vethernet|wsl|docker|loopback/i.test(name) &&
                    !network.address.startsWith("192.168.56.") &&
                    !network.address.startsWith("169.254.")
                );
            };

            // Put Wi-Fi addresses first.
            const ips = Object.entries(interfaces)
                .sort(([nameA], [nameB]) => {
                    const a = /wi-?fi|wlan/i.test(nameA) ? 0 : 1;
                    const b = /wi-?fi|wlan/i.test(nameB) ? 0 : 1;
                    return a - b;
                })
                .flatMap(([name, networks]) =>
                    networks
                        .filter(network => isValidIPv4(name, network))
                        .map(network => network.address)
                );

            if (!ips.length) {
                res.writeHead(400, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    error: "No LAN IPv4 address found"
                }));

                return;
            }

            const pin = String(
                crypto.randomInt(0, 1000000)
            ).padStart(6, "0");

            const token = crypto
                .randomBytes(32)
                .toString("hex");

            const expires = Date.now() + 120000;

            this.tcpServer.phase44Pair = {
                pin,
                token,
                expires
            };

            const payload = JSON.stringify({
                app: "SyncLAN",
                version: 1,
                ip: ips[0],
                token
            });

            QRCode.toDataURL(payload, {
                errorCorrectionLevel: "M",
                width: 300,
                margin: 2
            })
                .then(qr => {
                    res.writeHead(200, {
                        "Content-Type":
                            "application/json",
                        "Cache-Control": "no-store"
                    });

                    res.end(JSON.stringify({
                        pin,
                        qr,
                        ips,
                        expires
                    }));
                })
                .catch(e => {
                    res.writeHead(500, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(JSON.stringify({
                        error: e.message
                    }));
                });

            return;
        }

        if (
            req.url === "/api/pairing/connect" &&
            req.method === "POST"
        ) {
            let body = "";

            req.on("data", c => {
                body += c;

                if (body.length > 4096) {
                    req.destroy();
                }
            });

            req.on("end", () => {
                try {
                    const data = JSON.parse(body);

                    const ip = String(data.ip || "");
                    const kind = data.kind;
                    const value = String(data.value || "");

                    const validIp =
                        /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
                        ip.split(".").every(
                            x => Number(x) <= 255
                        );

                    const validCredential =
                        (
                            kind === "pin" &&
                            /^\d{6}$/.test(value)
                        ) ||
                        (
                            kind === "qr" &&
                            /^[a-f0-9]{64}$/.test(value)
                        );

                    if (
                        !validIp ||
                        !validCredential
                    ) {
                        throw Error(
                            "Invalid IP or pairing credential"
                        );
                    }

                    if (
                        this.connectionManager
                            .connectionState.status !==
                        "disconnected"
                    ) {
                        throw Error(
                            "Disconnect existing peer first"
                        );
                    }

                    this.connectionManager
                        .connectToDevice(
                            ip,
                            { kind, value }
                        );

                    res.writeHead(200, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(JSON.stringify({
                        success: true,
                        message: "Pairing request sent"
                    }));

                } catch (e) {
                    res.writeHead(400, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(JSON.stringify({
                        error: e.message
                    }));
                }
            });

            return;
        }

        // Serve QR decoder locally, without CDN.
        if (
            req.url === "/jsqr.js" &&
            req.method === "GET"
        ) {
            const file = require.resolve(
                "jsqr/dist/jsQR.js"
            );

            res.writeHead(200, {
                "Content-Type":
                    "application/javascript"
            });

            fs.createReadStream(file).pipe(res);

            return;
        }


        

        // PHASE43_API: preview, confirm, history.

        if (
            req.url === "/api/sync/history" &&
            req.method === "GET"
        ) {
            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                entries: this.phase43History.list()
            }));

            return;
        }

        if (
            req.url === "/api/sync/preview-status" &&
            req.method === "GET"
        ) {
            const cm = this.connectionManager;

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                ready: !!cm.phase43PreviewReady,
                error: cm.phase43PreviewError || null,
                previewId: this.phase43PreviewId || null,
                comparison: cm.phase43PreviewReady
                    ? cm.lastFolderComparison
                    : null
            }));

            return;
        }

        if (
            (
                req.url === "/api/sync/preview" ||
                req.url === "/api/sync/confirm"
            ) &&
            req.method === "POST"
        ) {
            let body = "";
            let tooLarge = false;

            req.on("data", c => {
                body += c;

                if (body.length > 1048576) {
                    tooLarge = true;
                    req.destroy();
                }
            });

            req.on("end", async () => {
                const send = (code, obj) => {
                    res.writeHead(code, {
                        "Content-Type": "application/json"
                    });

                    res.end(JSON.stringify(obj));
                };

                try {
                    if (tooLarge) {
                        throw Error("Request too large");
                    }

                    const data = JSON.parse(body);
                    const cm = this.connectionManager;

                    if (req.url === "/api/sync/preview") {
                        if (
                            !data.sourcePath ||
                            !data.destinationPath
                        ) {
                            throw Error(
                                "Both folder paths required"
                            );
                        }

                        if (
                            cm.connectionState.status !==
                            "connected"
                        ) {
                            throw Error(
                                "Connect to a peer first"
                            );
                        }

                        const manifest =
                            await FolderScanner.scanFolder(
                                data.sourcePath
                            );

                        const id = crypto.randomUUID();

                        const ok =
                            cm.sendFolderSyncRequest(
                                manifest,
                                data.sourcePath,
                                data.destinationPath
                            );

                        if (!ok) {
                            throw Error(
                                "Could not send folder preview request"
                            );
                        }

                        this.phase43PreviewId = id;

                        this.phase43History.add({
                            type: "preview",
                            status: "requested",
                            sourcePath: data.sourcePath,
                            destinationPath:
                                data.destinationPath,
                            totalFiles: manifest.length,
                            previewId: id
                        });

                        send(200, {
                            success: true,
                            previewId: id,
                            sourceFiles: manifest.length
                        });

                        return;
                    }

                    if (
                        !this.phase43PreviewId ||
                        data.previewId !==
                            this.phase43PreviewId ||
                        !cm.phase43PreviewReady
                    ) {
                        throw Error(
                            "Preview missing, stale, or not ready"
                        );
                    }

                    if (
                        cm.connectionState.status !==
                        "connected"
                    ) {
                        throw Error("Peer disconnected");
                    }

                    const comparison =
                        cm.lastFolderComparison;

                    const changed = [
                        ...comparison.newFiles,
                        ...comparison.modifiedFiles
                    ];

                    const allowed = new Map(
                        changed.map(f => [
                            f.relativePath,
                            f
                        ])
                    );

                    const selected =
                        data.mode === "whole"
                            ? changed.map(
                                f => f.relativePath
                            )
                            : data.selectedPaths;

                    if (
                        data.mode !== "whole" &&
                        data.mode !== "selective"
                    ) {
                        throw Error("Invalid sync mode");
                    }

                    if (
                        !Array.isArray(selected) ||
                        selected.some(
                            p =>
                                typeof p !== "string" ||
                                !allowed.has(p)
                        )
                    ) {
                        throw Error(
                            "Invalid selected paths"
                        );
                    }

                    const unique = [
                        ...new Set(selected)
                    ];

                    const root = path.resolve(
                        cm.pendingFolderSourcePath
                    );

                    // Verify files have not changed
                    // since the preview.

                    for (const rel of unique) {
                        const full = path.resolve(
                            root,
                            rel
                        );

                        if (
                            !full.startsWith(
                                root + path.sep
                            )
                        ) {
                            throw Error(
                                "Unsafe relative path"
                            );
                        }

                        const actual =
                            await require(
                                "../integrity/hashService"
                            ).hashFile(full);

                        if (
                            actual !==
                            allowed.get(rel).hash
                        ) {
                            throw Error(
                                "Source changed after preview: " +
                                rel
                            );
                        }
                    }

                    const entry =
                        this.phase43History.add({
                            type: "sync",
                            status: unique.length
                                ? "queued"
                                : "no-changes",
                            mode: data.mode,
                            sourcePath: root,
                            destinationPath:
                                cm.pendingFolderDestinationPath,
                            selectedFiles: unique,
                            verifiedFiles: [],
                            failedFiles: []
                        });

                    let queued = 0;

                    for (const rel of unique) {
                        const full = path.resolve(
                            root,
                            rel
                        );

                        const ok =
                            this.transferManager
                                .sendFileFromPath(
                                    full,
                                    rel,
                                    cm.pendingFolderDestinationPath
                                );

                        if (ok) {
                            queued++;

                            const active =
                                this.transferManager
                                    .activeTransfer;

                            if (
                                active &&
                                active.filePath === full &&
                                !active.phase43HistoryId
                            ) {
                                active.phase43HistoryId =
                                    entry.id;
                            }

                            for (
                                const t of
                                this.transferManager
                                    .transferQueue
                            ) {
                                if (
                                    t.filePath === full &&
                                    !t.phase43HistoryId
                                ) {
                                    t.phase43HistoryId =
                                        entry.id;
                                }
                            }
                        }
                    }

                    this.phase43History.update(
                        entry.id,
                        {
                            status:
                                queued === unique.length
                                    ? entry.status
                                    : "partially-queued",
                            queuedFiles: queued
                        }
                    );

                    this.phase43PreviewId = null;
                    cm.phase43PreviewReady = false;

                    send(200, {
                        success: true,
                        historyId: entry.id,
                        queued,
                        requested: unique.length
                    });

                    return;
                } catch (e) {
                    send(400, {
                        success: false,
                        message: e.message
                    });
                }
            });

            return;
        }

        // Phase 4.2: LAN chat and activity APIs.
        if (req.method === "GET" && req.url === "/api/chat/messages") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                messages: this.communicationService.getMessages()
            }));
            return;
        }

        if (req.method === "GET" && req.url === "/api/activity") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                activity: this.communicationService.getActivity()
            }));
            return;
        }

        if (req.method === "POST" && req.url === "/api/chat/send") {
            let body = "";
            let tooLarge = false;

            req.on("data", chunk => {
                body += chunk.toString();
                if (body.length > 8192) {
                    tooLarge = true;
                    req.destroy();
                }
            });

            req.on("end", () => {
                if (tooLarge) return;

                try {
                    const data = JSON.parse(body);
                    const result = this.communicationService.send(data.text);

                    res.writeHead(result.success ? 200 : 400, {
                        "Content-Type": "application/json"
                    });
                    res.end(JSON.stringify(result));
                } catch {
                    res.writeHead(400, {
                        "Content-Type": "application/json"
                    });
                    res.end(JSON.stringify({
                        success: false,
                        error: "Invalid request"
                    }));
                }
            });
            return;
        }

// Check whether there is a pending TCP connection request
        if (
            req.url === "/api/connection/pending" &&
            req.method === "GET"
        ) {

            const socket = this.tcpServer.pendingSocket;

            const response = {
                pending: socket !== null,
                ip: socket
                    ? socket.remoteAddress.replace("::ffff:", "")
                    : null
            };

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify(response));

            return;
        }


        // Accept the pending connection request
        if (
            req.url === "/api/connection/accept" &&
            req.method === "POST"
        ) {

            this.tcpServer.acceptConnection();

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                success: true
            }));

            return;
        }


        // Reject the pending connection request
        if (
            req.url === "/api/connection/reject" &&
            req.method === "POST"
        ) {

            this.tcpServer.rejectConnection();

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify({
                success: true
            }));

            return;
        }

        // Send the list of currently discovered LAN devices
        if (req.url === "/api/devices" && req.method === "GET") {
            const devices = this.discoveryService.deviceRegistry.getDevices();

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify(devices));

            return;
        }

        // Connect to a selected SyncLAN device
        if (
            req.url === "/api/connection/connect" &&
            req.method === "POST"
        ) {
            let body = "";

            req.on("data", (chunk) => {
                body += chunk.toString();
            });

            req.on("end", () => {
                try {
                    const data = JSON.parse(body);

                    this.connectionManager.connectToDevice(data.ip);

                    res.writeHead(200, {
                        "Content-Type": "application/json"
                    });

                    res.end(JSON.stringify({
                        success: true
                    }));

                } catch (error) {
                    res.writeHead(400, {
                        "Content-Type": "application/json"
                    });

                    res.end(JSON.stringify({
                        success: false
                    }));
                }
            });
            return;
        }

        // Send current TCP connection status to the webpage
        if (
            req.url === "/api/connection/status" &&
            req.method === "GET"
        ) {

            const status =
                this.connectionManager.connectionState.getStatus();

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify(status)
            );

            return;
        }

        // Send a file transfer request to the connected peer
        if (
            req.url === "/api/transfer/request" &&
            req.method === "POST"
        ) {

            let body = "";

            req.on("data", (chunk) => {
                body += chunk.toString();
            });

            req.on("end", () => {

                try {

                    const data = JSON.parse(body);

                    const success =
                        this.transferManager.sendTransferRequest(
                            data.fileName,
                            data.fileSize,
                            data.transferId
                        );

                    res.writeHead(
                        success ? 200 : 400,
                        {
                            "Content-Type": "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify({
                            success: success
                        })
                    );

                } catch (error) {

                    res.writeHead(400, {
                        "Content-Type": "application/json"
                    });

                    res.end(
                        JSON.stringify({
                            success: false
                        })
                    );
                }
            });

            return;
        }

        // Receive the selected file from the browser
        if (
            req.url === "/api/transfer/upload" &&
            req.method === "POST"
        ) {

            const tempDirectory = path.join(
                __dirname,
                "../../temp"
            );

            // Create temp directory if it does not exist
            if (!fs.existsSync(tempDirectory)) {
                fs.mkdirSync(tempDirectory, {
                    recursive: true
                });
            }

            let fileName = req.headers["x-file-name"];

            if (!fileName) {

                res.writeHead(400, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: false,
                    message: "File name is missing"
                }));

                return;
            }

            // Prevent a browser-supplied path from escaping temp/
            fileName = path.basename(fileName);

            const transferId = crypto.randomUUID();
            const tempFileName = `${transferId}-${fileName}`;

            const filePath = path.join(
                tempDirectory,
                tempFileName
            );

            const writeStream =
                fs.createWriteStream(filePath);

            req.pipe(writeStream);

            req.on("end", () => {

                console.log(
                    `File temporarily stored: ${fileName}`
                );

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: true,
                    fileName: fileName,
                    transferId: transferId,
                    filePath: filePath
                }));
            });

            req.on("error", (error) => {

                console.error(
                    "File upload error:",
                    error.message
                );

                writeStream.destroy();

                res.writeHead(500, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: false
                }));
            });

            return;
        }

        // Check outgoing file transfer status
        if (
            req.url === "/api/transfer/out-status" &&
            req.method === "GET"
        ) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(this.transferManager.getStatus()));
            
            return;
        }

        // Send pending file transfer request to the webpage
        if (
            req.url === "/api/transfer/pending" &&
            req.method === "GET"
        ) {
            const fileRequest = this.tcpServer.pendingFileRequest;

            const response = {
                pending: fileRequest !== null,
                fileName: fileRequest ? fileRequest.fileName : null,
                fileSize: fileRequest ? fileRequest.fileSize : null,
                transferId: fileRequest ? fileRequest.transferId : null,
                resume: fileRequest?.resume === true
            };

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(JSON.stringify(response));

            return;
        }

        // Accept incoming file transfer request
        if (
            req.url === "/api/transfer/accept" &&
            req.method === "POST"
        ) {
            const success =
                this.tcpServer.acceptFileTransfer();

            res.writeHead(
                success ? 200 : 400,
                {
                    "Content-Type": "application/json"
                }
            );

            res.end(
                JSON.stringify({
                    success: success,
                    error: success ? undefined : this.tcpServer.lastFileTransferError
                })
            );

            return;
        }


        // Reject incoming file transfer request
        if (
            req.url === "/api/transfer/reject" &&
            req.method === "POST"
        ) {
            const success =
                this.tcpServer.rejectFileTransfer();

            res.writeHead(
                success ? 200 : 400,
                {
                    "Content-Type": "application/json"
                }
            );

            res.end(
                JSON.stringify({
                    success: success
                })
            );

            return;
        }

        // Pause active transfer
        if (req.url === "/api/transfer/pause" && req.method === "POST") {
            const success = this.transferManager.pauseTransfer();
            res.writeHead(success ? 200 : 400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success }));
            return;
        }

        // Resume active transfer
        if (req.url === "/api/transfer/resume" && req.method === "POST") {
            const success = this.transferManager.resumeTransfer();
            res.writeHead(success ? 200 : 400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success }));
            return;
        }

        // Cancel active transfer
        if (req.url === "/api/transfer/cancel" && req.method === "POST") {
            const success = this.transferManager.cancelTransfer();
            res.writeHead(success ? 200 : 400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success }));
            return;
        }

        // Start folder comparison with connected peer
        if (
            req.url === "/api/sync/request" &&
            req.method === "POST"
        ) {

            let body = "";


            req.on("data", (chunk) => {

                body +=
                    chunk.toString();
            });


            req.on("end", async () => {

                try {

                    const data =
                        JSON.parse(body);


                    const sourceManifest =
                        await FolderScanner.scanFolder(
                            data.sourcePath
                        );


                    const success =
                        this.connectionManager
                            .sendFolderSyncRequest(
                                sourceManifest,
                                data.sourcePath,
                                data.destinationPath
                            );


                    res.writeHead(
                        success ? 200 : 400,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );


                    res.end(
                        JSON.stringify({
                            success:
                                success,

                            sourceFiles:
                                sourceManifest.length
                        })
                    );


                } catch (error) {

                    console.error(
                        "Folder sync request failed:",
                        error.message
                    );


                    res.writeHead(
                        400,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );


                    res.end(
                        JSON.stringify({
                            success:
                                false,

                            message:
                                error.message
                        })
                    );
                }
            });


            return;
        }

        // Return latest folder comparison
        if (
            req.url === "/api/sync/status" &&
            req.method === "GET"
        ) {

            const comparison =
                this.connectionManager
                    .lastFolderComparison;


            res.writeHead(
                200,
                {
                    "Content-Type":
                        "application/json"
                }
            );


            res.end(
                JSON.stringify({

                    ready:
                        comparison !== null,

                    comparison:
                        comparison
                })
            );


            return;
        }

        // Decide which frontend file the browser is requesting
        let filePath;

        if (req.url === "/") {

            filePath = path.join(
                __dirname,
                "../../../frontend/index.html"
            );

        } else if (req.url === "/style.css") {

            filePath = path.join(
                __dirname,
                "../../../frontend/style.css"
            );

        } else if (req.url === "/script.js") {

            filePath = path.join(
                __dirname,
                "../../../frontend/script.js"
            );

        } else if (req.url === "/phase45.js") {
            filePath = path.join(__dirname, "../../../frontend/phase45.js");
        } else if (req.url === "/phase44a.js") {
            filePath = path.join(
                __dirname,
                "../../../frontend/phase44a.js"
            );
        } else if (req.url === "/phase43.js") {
            filePath = path.join(
                __dirname,
                "../../../frontend/phase43.js"
            );
        } else if (req.url === "/phase42.js") {

            filePath = path.join(
                __dirname,
                "../../../frontend/phase42.js"
            );

        } else {

            // Requested page/file does not exist
            res.writeHead(404);
            res.end("Not Found");

            return;
        }

        // Read the requested frontend file
        fs.readFile(filePath, (error, data) => {

            if (error) {

                console.error(
                    "Error reading frontend file:",
                    error.message
                );

                res.writeHead(500);
                res.end("Server Error");

                return;
            }


            // Set the correct file type for the browser
            let contentType = "text/html";

            if (filePath.endsWith(".css")) {
                contentType = "text/css";
            }

            if (filePath.endsWith(".js")) {
                contentType = "text/javascript";
            }


            // Send the frontend file to the browser
            res.writeHead(200, {
                "Content-Type": contentType
            });

            res.end(data);
        });

    }
}


// Allow app.js to use WebServer
module.exports = WebServer;
