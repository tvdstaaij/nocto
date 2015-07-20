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

log.info('# Initializing ' + appInfo.identifier + ' #');
log.info('[1] Setup components and hooks');

process.on("unhandledRejection", function(error) {
    log.warn('Unhandled failure: ', error);
});

var services = {};
var serviceNames = config.get('services.register');
var messageFilterServices = [], messageHandlerServices = [];
serviceNames.forEach(function(serviceName) {
    var service = require('./services/' + serviceName + '.js');
    services[serviceName] = service;
    if (service.filterMessage) {
        messageFilterServices.push(serviceName);
    }
    if (service.handleMessage) {
        messageHandlerServices.push(serviceName);
    }
});
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

bot.on('messageReceived', function(message, meta) {
    // This is a candidate for refactoring into a service / filter
    // Would also make it possible to use resources like persistent storage
    if (config.get('behavior.allowPrivate.fromAll') === false &&
        meta.private) {
        return;
    }
    // Pass message through service filters
    Promise.each(messageFilterServices, function(serviceName) {
        var service = services[serviceName];
        return Promise.try(service.filterMessage.bind(service),
               [message, meta]).then(function(returnValue) {
            // All falsy values except undefined reject the message
            if (!returnValue && returnValue !== undefined) {
                return Promise.reject();
            }
        }).catch(function(error) {
            if (error) {
                log.error('Service ' + serviceName +
                          ' failed to filter message: error =', error,
                          ', message =', message);
            }
            return Promise.reject();
        });
    }).then(function() {
        // Pass message to service message handlers
        messageHandlerServices.forEach(function(serviceName) {
            var service = services[serviceName];
            try {
                service.handleMessage.call(service, message, meta);
            } catch (error) {
                log.error('Service ' + serviceName +
                ' failed to handle message: error =', error,
                ', message =', message);
            }
        });
        // Pass message to plugin message handlers
        plugins.invokeHandler('handleMessage', {
            requireEnabled: true
        }, [message, meta]);
    }).catch(function(rejection) {
        if (rejection !== undefined) {
            throw rejection;
        }
    });
});

// Boot step 1: get own identity (functions as API handshake as well)
function getMe() {
    if (config.api.disable) {
        return Promise.resolve();
    }
    log.info('[2] Contact Telegram API');
    return bot.api.getMe({}, {cache: false});
}

// Boot step 2: call service init handlers
var servicePromises = {};
function initServices() {
    log.info('[3] Initialize services (' + serviceNames.length + ')');
    serviceNames.forEach(function(serviceName) {
        var service = services[serviceName];
        var initResult = null;
        if (service.init) {
            initResult = new Promise(function(resolve) {
                process.nextTick(function() {
                    resolve(service.init(
                        extend(serviceResources, {
                            log: log4js.getLogger(serviceName)
                        }), function(targetServiceName) {
                            if (!servicePromises[targetServiceName]) {
                                return Promise.reject(new ReferenceError(
                                    'Service ' + targetServiceName +
                                    ' does not exist'
                                ));
                            }
                            return servicePromises[targetServiceName]
                            .then(function() {
                                return serviceFactory({
                                    type: 'service',
                                    name: serviceName
                                }, targetServiceName);
                            });
                        }
                    ));
                });
            });
        }
        servicePromises[serviceName] = initResult || Promise.resolve();
    });
    return Promise.props(servicePromises);
}

// Boot step 3: load available plugins
var pluginLoadList = config.get('plugins.register');
function loadPlugins() {
    log.info('[4] Load plugins (' + pluginLoadList.length + ')');
    return Promise.settle(plugins.load(pluginLoadList));
}

// Boot step 4: enable plugins marked for auto-enable
var pluginEnableList = config.get('plugins.autoEnabled');
function enablePlugins() {
    log.info('[5] Auto-enable plugins (' + pluginEnableList.length + ')');
    return Promise.settle(plugins.enable(pluginEnableList));
}

// Boot step 5: instruct bot client to start polling
function startPoll() {
    if (config.api.disable) {
        return;
    }
    log.info('[6] Start long polling loop');
    bot.poll.start();
}

getMe()
.tap(function(identity) {
    if (identity) {
        log.info("\t-> Identified myself as user #" + identity.id + ': @' +
                 identity.username + ' (' + identity.first_name + ')');
    }
})
.catch(function(error) { // Handle step 1 error
    if (config.get('api.mandatoryHandshake')) {
        log.fatal("\t-> Starting bot failed at the handshake phase:", error);
        process.exit(config.get('exitCodes.botStartFailed'));
    } else {
        log.error("\t-> API handshake failed:", error);
    }
})
.then(initServices)
.finally(function() {
    Object.keys(servicePromises).forEach(function(serviceName) {
        var promise = servicePromises[serviceName];
        if (promise.isFulfilled()) {
            log.info("\t-> Initialized service " + serviceName);
        } else {
            log.fatal("\t-> Failed to initialize service " + serviceName);
        }
    });
})
.catch(function() {
    process.exit(config.get('exitCodes.botStartFailed'));
})
.then(loadPlugins)
.tap(function(promises) {
    promises.forEach(function(promise, index) {
        var plugin = pluginLoadList[index];
        if (promise.isFulfilled()) {
            log.info("\t-> Loaded plugin " + plugin);
        } else {
            log.error("\t-> Failed to load plugin " + plugin + ':',
                      promise.reason());
        }
    });
})
.then(enablePlugins)
.tap(function(promises) {
    promises.forEach(function(promise, index) {
        var plugin = pluginEnableList[index];
        if (promise.isFulfilled()) {
            log.info("\t-> Automatically enabled plugin " + plugin);
        } else {
            log.error("\t-> Failed to automatically enable plugin " +
                      plugin + ':', promise.reason());
        }
    });
})
.then(startPoll)
.tap(function() {
    log.info("# Initialization complete #");
}).catch(function (error) {
    log.fatal('Unhandled error during init: ', error);
    process.exit(config.get('exitCodes.botStartFailed'));
});
