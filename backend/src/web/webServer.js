// Built-in Node.js modules for the local web server and frontend files
const http = require("http");
const fs = require("fs");
const path = require("path");


class WebServer {

    constructor(tcpServer, discoveryService, connectionManager) {

        // Store TCP server so the webpage can access connection requests
        this.tcpServer = tcpServer;
        // Access discovered devices and create outgoing TCP connections
        this.discoveryService = discoveryService;
        this.connectionManager = connectionManager;

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
                ip: socket ? socket.remoteAddress : null
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
        if ( req.url === "/api/devices" && req.method === "GET"){
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