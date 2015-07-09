var config = require('config');
var extend = require('util-extend');
var fs = require('fs');
var path = require('path');
var log4js = require('log4js');
var Q = require('q');
var PluginManager = require('./lib/pluginmanager.js');
var TgBot = require('./lib/tgbot.js');
var botUtil = require('./lib/utilities.js');
var pjson = require('./package.json');

log4js.configure(config.get('log'));
var log = log4js.getLogger('nocto');

var heapdumpSetting = config.get('debug.heapdump');
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
    makeHeapdump();
    // And after init has probably finished
    setTimeout(makeHeapdump, 10000);
    // And according to period setting
    setInterval(makeHeapdump, heapdumpSetting * 1000);
}
var memlogSetting = config.get('debug.memlog');
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

log.info('Initializing nocto/' + pjson.version);
log.info('[1] Setup components and hooks');

botUtil.setAppRoot(__dirname);

var services = {};
config.get('services.register').forEach(function(serviceName) {
    var service = require('./services/' + serviceName + '.js');
    if (service.init) {
        service.init(config, services);
    }
    services[serviceName] = service;
});

var bot = new TgBot(extend(config.get('api'), {
    logCategory: 'tgbot',
    commandPrefix: config.get('behavior.commandPrefix')
}));

var pluginResources = {
    log: log4js.getLogger('plugins'),
    api: bot.api
};
var plugins = new PluginManager(extend(config.get('plugins'), {
    basePath: path.join(__dirname, 'plugins')
}), pluginResources, services);

bot.on('messageReceived', function(message, meta) {
    // This is a candidate for refactoring into a service / filter
    // Would also make it possible to use resources like persistent storage
    if (config.get('behavior.allowPrivate.fromAll') === false &&
        meta.private) {
        return;
    }
    plugins.invokeHandler('handleMessage', {
        requireEnabled: true
    }, [message, meta]);
});

// Boot step 1: get own identity (functions as API test as well)
function getMe() {
    log.info('[2] Contact Telegram API');
    return bot.api.getMe({}, {cache: false});
}

// Boot step 2: load available plugins
var pluginLoadList = config.get('plugins.register');
function loadPlugins() {
    log.info('[3] Load plugins');
    return Q.allSettled(plugins.load(pluginLoadList));
}

// Boot step 3: enable plugins marked for auto-enable
var pluginEnableList = config.get('plugins.autoEnabled');
function enablePlugins() {
    log.info('[4] Auto-enable plugins');
    return Q.allSettled(plugins.enable(pluginEnableList));
}

// Boot step 4: instruct bot client to start polling
function startPoll() {
    log.info('[5] Start long polling loop');
    return Q.fcall(bot.poll.start);
}

getMe() // Execute step 1
.then(function(identity) { // Handle step 1 success
    log.info('Identified myself as user #' + identity.id + ': @' +
         identity.username + ' (' + identity.first_name + ')');
    return loadPlugins(); // Execute step 2
}, function(error) { // Handle step 1 error
    log.fatal('Starting bot failed at the getMe phase:', error);
    process.exit(config.get('exitCodes.botStartFailed'));
})
.then(function(promises) { // Handle step 2 result
    promises.forEach(function(promise, index) {
        var plugin = pluginLoadList[index];
        if (promise.state === 'fulfilled') {
            log.info('Loaded plugin ' + plugin);
        } else {
            log.error('Failed to load plugin ' + plugin + ':',
                      promise.reason);
        }
    });
    return enablePlugins(); // Execute step 3
})
.then(function(promises) { // Handle step 3 result
    promises.forEach(function(promise, index) {
        var plugin = pluginEnableList[index];
        if (promise.state === 'fulfilled') {
            log.info('Automatically enabled plugin ' + promise.value.name);
        } else {
            log.error('Failed to automatically enable plugin ' + plugin + ':',
                      promise.reason);
        }
    });
    return startPoll(); // Execute step 4
})
.finally(function() {
    log.info('Initialization complete');
})
.done(); // Any hard errors (exceptions) in steps 2-4 are fatally rethrown here
