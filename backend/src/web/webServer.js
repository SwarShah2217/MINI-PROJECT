// Built-in Node.js modules for the local web server and frontend files
const http = require("http");
const fs = require("fs");
const path = require("path");


class WebServer {

    constructor(tcpServer, discoveryService, connectionManager, transferManager) {

        // Store TCP server so the webpage can access connection requests
        this.tcpServer = tcpServer;
        // Access discovered devices and create outgoing TCP connections
        this.discoveryService = discoveryService;
        this.connectionManager = connectionManager;
        this.transferManager = transferManager;

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
                            data.fileSize
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

            const filePath = path.join(
                tempDirectory,
                fileName
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

        // Send pending file transfer request to the webpage
        if (
            req.url === "/api/transfer/pending" &&
            req.method === "GET"
        ) {
            const fileRequest = this.tcpServer.pendingFileRequest;

            const response = {
                pending: fileRequest !== null,
                fileName: fileRequest ? fileRequest.fileName : null,
                fileSize: fileRequest ? fileRequest.fileSize : null
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
                    success: success
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