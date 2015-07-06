module.exports = function loadPlugin(resources) {

    var log = resources.log;
    
    var asyncDummy = function(cb) {
        process.nextTick(function() {
            cb(null, true);
        });
    };
    
    return {
        enable: asyncDummy,
        disable: asyncDummy,
        handleMessage: function(message, meta) {
            log.trace('[trace.handleMessage] meta:', meta,
                      ', message:', message);
        }
    };
};
