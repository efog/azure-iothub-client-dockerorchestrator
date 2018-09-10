const Client = require("azure-iot-device").Client;
const ConnectionString = require("azure-iot-device").ConnectionString;
const TwinDockerManager = require("./twin-docker-manager");
const dbg = require("debug");
const error = dbg("ERROR:athena.pi.iothubclient:AzureIotHubClient");
const info = dbg("INFO:athena.pi.iothubclient:AzureIotHubClient");
const fs = require("fs");
const path = require("path");
const Protocol = require("azure-iot-device-mqtt").Mqtt;

info.log = console.log.bind(console);

/**
 * Azure IOT Hub Client bootstrap class
 *
 * @class AzureIotClient
 */
class AzureIotHubClient {

    /**
     * Default constructor
     * @param {*} config Azure IOT Hub configuration
     */
    constructor(config) {
        this._client = null;
        this._config = config;
        info(`running with config ${JSON.stringify(config)}`);
        this._connectionString = this._config.connectionString;
        this._messageId = 0;
        this._twin = null;
        this._twinDockerManager = null;
    }
    get client() {
        if (!this._client) {
            info('Creating instance of client...');
            this._client = this.initClient();
        }
        return this._client;
    }
    clientOpened(err) {
        info(`Client opened`);
        if (err) {
            error(`[IoT hub Client] ${err.message}\r\n${err.stacktrace}\r\n${JSON.stringify(err)}`);
            error(`[IoT hub Client] Connect error: ${err.message}`);
            return;
        }
        // set C2D and device method callback
        this._client.onDeviceMethod("start", (request, response) => {
            info(`Client started`);
            this.clientOnStart(request, response);
        });
        this._client.onDeviceMethod("stop", (request, response) => {
            info(`Client stopped`);
            this.clientOnStop(request, response);
        });
        this._client.on("message", (message) => {
            this.clientOnReceiveMessage(message);
        });
        this._twinDockerManager = new TwinDockerManager(this._config.registries ? this._config.registries : {});
        setTimeout(() => {
            this._client.getTwin((getTwinError, twin) => {
                if (getTwinError) {
                    error("get twin message error");
                    return;
                }
                twin.desiredPropertiesUpdatesEnabled = true;
                this._twinDockerManager.twin = twin;
            });
        }, 0);
    }
    clientOnReceiveMessage(msg) {
        const message = msg.getData().toString("utf-8");
        this._client.complete(msg, () => {});
    }
    clientOnStart(request, response) {
        info(`Try to invoke method start (${request.payload})`);
        this._sendingMessage = true;
        response.send(200, "Successully start sending message to cloud", (err) => {
            if (err) {
                error(`[IoT hub Client] ${err.message}\r\n${err.stacktrace}\r\n${JSON.stringify(err)}`);
                error(`[IoT hub Client] Failed sending a method response:\n ${err.message}`);
            }
        });
    }
    clientOnStop(request, response) {
        info(`Try to invoke method stop (${request.payload})`);
        this._sendingMessage = false;
        response.send(200, "Successully stop sending message to cloud", function (err) {
            if (err) {
                error(`[IoT hub Client] ${err.message}\r\n${err.stacktrace}\r\n${JSON.stringify(err)}`);
                error(`[IoT hub Client] Failed sending a method response:\n ${err.message}`);
            }
        });
    }
    initClient() {
        info(`Using connection string ${this._connectionString}`);
        const connectionString = ConnectionString.parse(this._connectionString);
        const deviceId = connectionString.DeviceId;
        const client = Client.fromConnectionString(this._connectionString, Protocol);
        // Configure the client to use X509 authentication if required by the connection string.
        if (connectionString.x509) {
            // Read X.509 certificate and private key.
            // These files should be in the current folder and use the following naming convention:
            // [device name]-cert.pem and [device name]-key.pem, example: myraspberrypi-cert.pem
            const connectionOptions = {
                "cert": fs.readFileSync(path.join(this._config.credentialPath, `${deviceId}-cert.pem`)).toString(),
                "key": fs.readFileSync(path.join(this._config.credentialPath, `${deviceId}-key.pem`)).toString()
            };
            client.setOptions(connectionOptions);
            info("[Device] Using X.509 client certificate authentication");
        }
        return client;
    }
    sendMessage() {
        if (this._sendingMessage) {
            return;
        }
        this._messageId++;
    }
    start() {
        info('Starting...');
        this.client.open((err) => {
            this.clientOpened(err);
        });
    }
}
module.exports = AzureIotHubClient;