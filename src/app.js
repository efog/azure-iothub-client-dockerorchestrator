const AzureIotHubClient = require("./azure-iothubclient");
const dbg = require("debug");
const error = dbg("ERROR:athena.pi.iothubclient:App");
const fs = require("fs");
const info = dbg("INFO:athena.pi.iothubclient:App");

let config = null;
try {
    config = process.env.CONFIG_PATH ? require(process.env.CONFIG_PATH) : require("./config/config.json");
} catch (err) {
    error(err);
    info(`can't load config, using dummy`);
    config = {
        "interval": 60000,
        "deviceId": "Raspberry Pi Dev Node",
        "credentialPath": "~/.iot-hub",
        "connectionString": null
    };
}

const client = new AzureIotHubClient(config);

client.start();