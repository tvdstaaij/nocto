var fs = require('fs');

var log, config;

module.exports.init = function(resources) {
    log = resources.log;
    config = resources.config.get('services.config.memdebug');

    var heapdumpSetting = config.heapdump;
    if (heapdumpSetting) {
        var heapdump = require('heapdump');
        try {
            fs.mkdirSync('./heapdump');
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
        var makeHeapdump = function() {
            heapdump.writeSnapshot('./heapdump/' + Date.now() + '.heapsnapshot',
            function(err, filename) {
                if (err) {
                    log.error('Heap dump failed:', err);
                } else {
                    log.debug('Heap dump written to', filename);
                }
            });
        };
        // Snapshot right now
        process.nextTick(makeHeapdump);
        // And after init has probably finished
        setTimeout(makeHeapdump, config.heapdumpDelay || 10000);
        // And according to period setting
        setInterval(makeHeapdump, heapdumpSetting * 1000);
    }

    var memlogSetting = config.memlog;
    if (memlogSetting) {
        setInterval(function() {
            var memoryUsage = process.memoryUsage();
            Object.keys(memoryUsage).forEach(function(stat) {
                memoryUsage[stat] = (memoryUsage[stat] / 1024 / 1024)
                .toFixed(1) + 'MiB';
            });
            log.debug('Memory usage:', memoryUsage);
        }, memlogSetting * 1000);
    }
};
