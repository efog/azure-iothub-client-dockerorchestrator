const ContainerHelper = require("./container-helper");
const Docker = require("dockerode");
const Promise = require("bluebird");
const dbg = require("debug");
const error = dbg("ERROR:athena.pi.iothubclient:TwinDockerManager");
const info = dbg("INFO:athena.pi.iothubclient:TwinDockerManager");

const dockerHost = process.env.DOCKER_HOST || "localhost";
const dockerPort = process.env.DOCKER_PORT || 2375;
const dockerProtocol = process.env.DOCKER_PROTOCOL || "socket";
const dockerSocket = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

info.log = console.log.bind(console);

/**
 * Twin configuration Docker Manager class
 */
class TwinDockerManager {

    constructor(twin, registries) {
        this._twin = twin;
        this._registries = registries;
        twin.on("properties.desired.containers", (delta) => {
            this.handleDelta(delta);
        });
        this._docker = dockerProtocol === "socket" ? new Docker() : new Docker({
            "protocol": dockerProtocol,
            "port": dockerPort,
            "host": dockerHost
        });
    }

    getLocalContainerChanges(desiredDelta) {
        const results = {};
        const toStart = [];
        const toStop = [];
        const desiredDeltaKeys = Object.keys(desiredDelta);
        // Get those necessary to stop
        return this.listRunningContainers()
            .then((containers) => {
                return Promise.resolve(containers.map((container) => {
                    return new ContainerHelper(container);
                }));
            })
            .then((localContainers) => {
                localContainers.forEach((item) => {
                    const localContainer = item;
                    if (!desiredDelta[localContainer.name] ||
                        desiredDelta[localContainer.name].tag !== localContainer.tag ||
                        desiredDelta[localContainer.name].state === "stopped") {
                        toStop.push(localContainer);
                    }
                });
                return Promise.resolve();
            })
            .then(() => {
                return this.listAllContainers();
            })
            .then((containers) => {
                return Promise.resolve(containers.map((container) => {
                    return new ContainerHelper(container);
                }));
            })
            .then((localContainers) => {
                // Get those to start
                desiredDeltaKeys.forEach((key) => {
                    // not running
                    const desired = desiredDelta[key];
                    if (desired.state === "running") {
                        let foundLocally = false;
                        let isRunningLocally = false;
                        for (let idx = 0; idx < localContainers.length; idx++) {
                            const localContainer = localContainers[idx];
                            const matchesTag = localContainer.tag === desired.tag;
                            const matchesImage = localContainer.image === desired.image;
                            const hasToRun = localContainer.state !== "running";
                            isRunningLocally = isRunningLocally || matchesImage && matchesTag && !hasToRun;
                            foundLocally = foundLocally || matchesImage && matchesTag;
                        }
                        if (!foundLocally || !isRunningLocally) {
                            toStart.push(desired);
                        }
                    }
                });
                return Promise.resolve();
            })
            .then(() => {
                results.toStart = toStart;
                results.toStop = toStop;
                return Promise.resolve(results);
            });
    }

    /**
     * Stop containers
     *
     * @param {Array<any>} toStop array of containers to stop
     * @returns {Promise} execution promise
     * 
     * @memberof TwinDockerManager
     */
    stopContainers(toStop) {
        const namesToStop = {};
        for (let index = 0; index < toStop.length; index++) {
            const element = toStop[index];
            namesToStop[element.name] = element;
        }
        return this.listRunningContainers()
            .then((containers) => {
                const promises = [];
                for (let index = 0; index < containers.length; index++) {
                    const element = containers[index];
                    const container = new ContainerHelper(element);
                    if (namesToStop[container.name]) {
                        const target = this._docker.getContainer(container.id);
                        const promise = target.stop()
                            .then(() => {
                                return target.remove();
                            })
                            .then(() => {
                                return this._docker.listImages({
                                    "dangling": true
                                });
                            })
                            .then((images) => {
                                const imagesToRemove = images.map((image) => {
                                    const found = this._docker.getImage(image.Id);
                                    return found.remove();
                                });
                                return Promise.all(imagesToRemove);
                                // return this._docker.pruneImages({"dangling": true});
                            });
                        promises.push(promise);
                    }
                }
                return Promise.all(promises);
            })
            .then(() => {
                return Promise.resolve();
            });
    }

    /**
     * Starts containers
     *
     * @param {*} toStart containers to start
     * @returns {Promise} execution promise
     * @memberof TwinDockerManager
     */
    startContainers(toStart) {
        const promises = [];
        for (let index = 0; index < toStart.length; index++) {
            const element = toStart[index];
            const image = `${element.image}${element.tag ? `:${element.tag}` : ""}`;

            const bindKeys = element.volumes ? Object.keys(element.volumes) : [];
            const binds = [];
            bindKeys.forEach((key) => {
                binds.push(`${key}:${element.volumes[key]}`);
            });

            const portsKeys = element.ports ? Object.keys(element.ports) : [];
            const exposedPorts = {};
            const portBindings = {};
            portsKeys.forEach((key) => {
                exposedPorts[key] = {};
                portBindings[`${key}/tcp`] = [{
                    "HostPort": element.ports[key],
                    "HostIp": "0.0.0.0"
                }];
            });

            const opts = {
                "Image": image,
                "HostConfig": {
                    "Binds": binds,
                    "PortBindings": portBindings
                },
                "NetworkMode": element.networkMode ? element.networkMode : "bridge"
            };
            const registryName = element.image.split(":")[0].split("/")[0];
            const registry = this._registries[registryName];
            const auth = {
                "username": registry.username,
                "password": registry.password,
                "auth": "",
                "email": registry.email,
                "serveraddress": registry.serveraddress
            };
            const promise = this._docker.pull(image, {
                "authconfig": auth
            })
                .then((stream) => {
                    const pullPromise = new Promise((resolve, reject) => {
                        const onfinished = (evt) => {
                            return resolve(this._docker.createContainer(opts));
                        };
                        const onprogress = (evt) => {};
                        this._docker.modem.followProgress(stream, onfinished, onprogress);
                    });
                    return pullPromise;
                })
                .then((container) => {
                    return container.start();
                });
            promises.push(promise);
        }
        return Promise.all(promises);
    }

    /**
     * Apply requested delta on current container engine
     *
     * @param {*} delta delta to apply to current configuration
     * @returns {Array<Container>} containers state
     * @memberof TwinDockerManager
     */
    applyContainerChanges(delta) {
        let changes = null;
        return this.getLocalContainerChanges(delta)
            .then((results) => {
                changes = results;
                return this.stopContainers(changes.toStop);
            })
            .then(() => {
                return this.startContainers(changes.toStart);
            })
            .then(() => {
                return Promise.resolve(delta);
            });
    }

    /**
     * Handle IoT Twin config delta on desired.containers property
     *
     * @param {*} delta twin config delta
     * @return {undefined}
     * 
     * @memberof DockerManager
     */
    handleDelta(delta) {
        return this.applyContainerChanges(delta)
            .then((containers) => {
                const rptContainers = {};
                const keys = Object.keys(containers);
                for (let idx = 0; idx < keys.length; idx++) {
                    const key = keys[idx];
                    const container = containers[key];
                    container.timestamp = new Date();
                    rptContainers[key] = container;
                }
                const promise = new Promise((resolve, reject) => {
                    this._twin.properties.reported.update({
                        "containers": rptContainers
                    }, (err) => {
                        if (err) {
                            return reject(err);
                        }
                        return resolve();
                    });
                });
                return promise;
            })
            .catch((err) => {
                error(JSON.stringify(err));
            });
    }

    /**
     * Handle container tag change
     *
     * @param {*} delta change delta
     * @returns {undefined}
     * @memberof TwinDockerManager
     */
    handleTagDelta(delta) {
        info(`Received delta ${JSON.stringify(delta)}`);
    }

    /**
     * Lists all running containers as an async promise
     *
     * @returns {Promise<any>} list of running containers
     * @memberof TwinDockerManager
     */
    listRunningContainers() {
        return this._docker.listContainers({
            "filters": {
                "status": ["running"]
            }
        });
    }

    /**
     * Lists all stopped containers as an async promise
     *
     * @returns {Promise<any>} list of running containers
     * @memberof TwinDockerManager
     */
    listStoppedContainers() {
        return this._docker.listContainers({
            "limit": 1,
            "filters": {
                "status": ["restarting", "removing", "paused", "exited", "dead"]
            }
        });
    }

    /**
     * Lists all containers as an async promise
     *
     * @returns {Promise<any>} list of running containers
     * @memberof TwinDockerManager
     */
    listAllContainers() {
        return this._docker.listContainers({
            "filters": {
                "status": ["exited", "running"]
            }
        });
    }
}

module.exports = TwinDockerManager;