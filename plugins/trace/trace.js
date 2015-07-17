module.exports = function loadPlugin(resources) {

    var log = resources.log;
    
    return {
        handleMessage: function(message, meta) {
            log.info('handleMessage: meta =', meta, ', message =', message);
        }
    };
};
