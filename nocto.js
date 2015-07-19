var config = require('config');
var extend = require('util-extend');
var fs = require('fs');
var path = require('path');
var log4js = require('log4js');
var Promise = require('bluebird');
var PluginManager = require('./lib/pluginmanager.js');
var TgBot = require('./lib/tgbot.js');
var pjson = require('./package.json');

log4js.configure(config.get('log'));
var log = log4js.getLogger('nocto');

var appInfo = {
    pjson: pjson,
    root: __dirname,
    identifier: pjson.name + '/' + pjson.version
};

log.info('# Initializing ' + appInfo.identifier + '#');
log.info('[1] Setup components and hooks');

process.on("unhandledRejection", function(error) {
    log.warn('Unhandled failure: ', error);
});

var services = {};
var serviceFactory = function(context, serviceName) {
    var service = services[serviceName];
    if (service && service.provides) {
        return service.provides(context);
    }
    return false;
};

var bot = new TgBot(extend(config.get('api'), {
    logCategory: 'tgbot',
    commandPrefix: config.get('behavior.commandPrefix')
}));

var pluginResources = {
    api: bot.api,
    app: appInfo
};
var plugins = new PluginManager(extend(config.get('plugins'), {
    basePath: path.join(__dirname, 'plugins')
}), pluginResources, serviceFactory);

var serviceResources = {
    app: appInfo,
    bot: bot,
    plugins: plugins,
    config: config
};

var serviceNames = config.get('services.register');
serviceNames.forEach(function(serviceName) {
    services[serviceName] = require('./services/' + serviceName + '.js');
});
serviceNames.forEach(function(serviceName) {
    var service = services[serviceName];
    if (service && service.init) {
        service.init(
        extend(serviceResources, {
            log: log4js.getLogger(serviceName)
        }),
        serviceFactory.bind(
            undefined, {
                type: 'service',
                name: serviceName
            }
        ));
    }
});

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
    return Promise.resolve(bot.api.getMe({}, {cache: false})); // Temp
}

// Boot step 2: load available plugins
var pluginLoadList = config.get('plugins.register');
function loadPlugins() {
    log.info('[3] Load plugins');
    return Promise.settle(plugins.load(pluginLoadList));
}

// Boot step 3: enable plugins marked for auto-enable
var pluginEnableList = config.get('plugins.autoEnabled');
function enablePlugins() {
    log.info('[4] Auto-enable plugins');
    return Promise.settle(plugins.enable(pluginEnableList));
}

// Boot step 4: instruct bot client to start polling
function startPoll() {
    log.info('[5] Start long polling loop');
    bot.poll.start();
}

getMe() // Execute step 1
.then(function(identity) { // Handle step 1 success
    log.info("\t-> Identified myself as user #" + identity.id + ': @' +
         identity.username + ' (' + identity.first_name + ')');
    return loadPlugins(); // Execute step 2
}, function(error) { // Handle step 1 error
    log.fatal('Starting bot failed at the getMe phase:', error);
    process.exit(config.get('exitCodes.botStartFailed'));
})
.then(function(promises) { // Handle step 2 result
    promises.forEach(function(promise, index) {
        var plugin = pluginLoadList[index];
        if (promise.isFulfilled()) {
            log.info("\t-> Loaded plugin " + plugin);
        } else {
            log.error("\t-> Failed to load plugin " + plugin + ':',
                      promise.reason());
        }
    });
    return enablePlugins(); // Execute step 3
})
.then(function(promises) { // Handle step 3 result
    promises.forEach(function(promise, index) {
        var plugin = pluginEnableList[index];
        if (promise.isFulfilled()) {
            log.info("\t-> Automatically enabled plugin " + plugin);
        } else {
            log.error("\t-> Failed to automatically enable plugin " + plugin + ':',
                      promise.reason());
        }
    });
    return startPoll(); // Execute step 4
})
.tap(function() {
    log.info("# Initialization complete #");
}).done();
