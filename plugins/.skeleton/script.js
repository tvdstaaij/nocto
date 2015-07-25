var handlers = {};

module.exports = function loadPlugin(resources, service) {
    return handlers;
};

handlers.enable = function(cb) {
    process.nextTick(function() {
        cb(null, true);
    });
};

handlers.disable = function(cb) {
    process.nextTick(function() {
        cb(null, true);
    });
};

handlers.handleMessage = function(message, meta) {

};
