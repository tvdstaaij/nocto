var config;

module.exports.init = function(resources) {
    config = resources.config.get('services.config.interact');
};

module.exports.provides = function() {
    return {
        session: getSessionPool
    };
};

function getSessionPool(timeout) {
    if (timeout === undefined) {
        timeout = config.defaultTimeout;
    }
    var sessions = {};
    return function getSession(id) {
        var session = sessions[id];
        if (!session) {
            session = new UserSession(timeout);
            sessions[id] = session;
        }
        return session;
    };
}

function UserSession(timeout) {
    this._timeout = timeout;
    this.reset();
}

UserSession.prototype.reset = function() {
    this.data = {};
    this._state = null;
    this._clearTimer();
};

UserSession.prototype.state = function(newState) {
    if (newState !== undefined) {
        this._state = newState;
        this.touch();
    }
    return this._state;
};

UserSession.prototype.touch = function() {
    this._clearTimer();
    if (this._timeout) {
        this._timer = setTimeout(this.reset.bind(this), this._timeout);
    }
};

UserSession.prototype._clearTimer = function() {
    if (this._timer) {
        clearTimeout(this._timer);
    }
    this._timer = null;
};
