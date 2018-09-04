class ContainerHelper {
    constructor(container) {
        this._source = container;
    }
    get name() {        
        const nameParts = this._source.Image.split(":")[0].split("/");
        return nameParts[nameParts.length - 1];
    }
    get image() {
        return this._source.Image.split(":")[0];
    }
    get tag() {
        return this._source.Image.split(":")[1];
    }
    get state() {
        return this._source.State;
    }
    get id() {
        return this._source.Id;
    }
}

module.exports = ContainerHelper;