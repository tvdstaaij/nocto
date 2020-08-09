var _ = require('lodash');
var fs = require('fs');
var os = require('os');
var path = require('path');
var Promise = require('bluebird');
var log4js = require('log4js');
var botUtil = require('./lib/utilities.js');
var pjson = require('./package.json');
var setupWizard = require('./setupwizard.js');
var TgBot = require('./lib/tgbot.js');

var log = log4js.getLogger('nocto');

var nodeVersion = process.versions.node.split('.');
if (nodeVersion[0] === '0' && nodeVersion[1] < 12) {
    log.fatal('Your node version is ' + process.version + ', but ' +
              pjson.name + ' needs at least v0.12');
    process.exit(config.get('exitCodes.botStartFailed'));
}

if (!setupWizard.isConfigCustomized()) {
    log.info('No user configuration found');
    log.info('Starting interactive setup wizard');
    process.stdout.write(os.EOL);
    // setupWizard.exec deliberately blocks the process until it finishes
    var setupWizardOk = setupWizard.exec();
    process.stdout.write(os.EOL);
    if (!setupWizardOk) {
        log.fatal('Setup wizard was aborted, not starting bot. If there was ' +
                  'some kind of problem, please correct the error and try ' +
                  'again, or create config/local.json manually.');
        process.exit(1);
    }
}

// Config module and modules requiring config must be loaded after setup wizard
var config = require('config');
var PluginManager = require('./lib/pluginmanager.js');
var web = config.get('web.enabled') ? require('./lib/web.js') : null;

log4js.configure(config.get('log'));

var appInfo = {
    pjson: pjson,
    root: __dirname,
    identifier: pjson.name + '/' + pjson.version
};
var bootStep = 0;

log.info('# Initializing ' + appInfo.identifier + ' #');
logBootStep('Setup components and hooks');

process.on('unhandledRejection', function(error) {
    log.warn('Unhandled failure: ', error);
});

process.on('beforeExit', function() {
    log.fatal('The Node process has nothing left to do. This could be caused ' +
              'by various conditions, including API poll failure with retry ' +
              'disabled and service dependency deadlock.');
    process.exit(config.get('exitCodes.unexpectedExit'));
});

process.once('SIGINT', function() {
    log.info(
        'Interrupt received, initiating shutdown (interrupt again to force)'
    );
    process.once('SIGINT', function() {
        log.fatal('Interrupted twice, force shutdown');
        process.exit(config.exitCodes.forcedInterruptExit);
    });
    var disableList = _.filter(plugins.getNames(), plugins.isEnabled);
    var disablePromises = _.mapValues(plugins.disable(disableList),
        function(promise, pluginName) {
            return watchPluginResult(pluginName, 'disable', promise);
        }
    );
    Promise.settle(_.toArray(disablePromises)).then(function() {
        var cleanShutdown = _.every(disablePromises, function(promise) {
            return promise.isFulfilled();
        });
        if (cleanShutdown) {
            log.info('Clean shutdown');
            process.exit(config.exitCodes.cleanInterruptExit);
        } else {
            log.fatal('One or more plugins did not disable cleanly');
            process.exit(config.exitCodes.dirtyInterruptExit);
        }
    });
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

var bot = new TgBot(_.extend(config.get('api'), {
    logCategory: 'tgbot',
    commandPrefix: config.get('behavior.commandPrefix')
}));

var pluginResources = {
    api: bot.api,
    app: appInfo,
    web: web ? web.toPluginResource() : null
};
var plugins = new PluginManager(_.extend(config.get('plugins'), {
    basePath: path.join(__dirname, 'plugins')
}), pluginResources, serviceFactory);
plugins.enableLater(config.get('plugins.autoEnabled'));

var serviceResources = {
    app: appInfo,
    bot: bot,
    plugins: plugins,
    config: config,
    web: web ? web.toServiceResource() : null
};

_.forEach(['message', 'inlineQuery'], function(updateType) {
    var dispatcher = _.partial(dispatchUpdate, _.upperFirst(updateType));
    bot.on(updateType + 'Received', dispatcher);
});

function dispatchUpdate(type, contents, meta) {
    // Pass message through service filters
    var filterPromise = type !== 'Message' ? Promise.resolve() :
    Promise.each(messageFilterServices, function(serviceName) {
        var service = services[serviceName];
        return Promise.try(service.filterMessage.bind(service),
            [contents, meta]).then(function(returnValue) {
            // All falsy values except undefined reject the message
            if (!returnValue && returnValue !== undefined) {
                return Promise.reject();
            }
        }).catch(function(error) {
            if (error) {
                log.error('Service ' + serviceName +
                    ' failed to filter message: error =', error,
                    ', message =', contents);
            }
            return Promise.reject();
        });
    });

    filterPromise.then(function() {
        // Pass message to service message handlers
        if (type === 'Message') {
            messageHandlerServices.forEach(function (serviceName) {
                var service = services[serviceName];
                try {
                    service.handleMessage.call(service, contents, meta);
                } catch (error) {
                    log.error('Service ' + serviceName +
                        ' failed to handle message: error =', error,
                        ', message =', contents);
                }
            });
        }
        // Pass to plugin event handlers
        plugins.invokeHandler('handle' + type, {
            requireEnabled: true
        }, [contents, meta]);
    }).catch(function(rejection) {
        if (rejection !== undefined) {
            throw rejection;
        }
    });
}

function logBootStep(description) {
    log.info('[' + String(++bootStep) + '] ' + description);
}

function watchPluginResult(name, operation, promise) {
    var succeedFunc = _.partial(logPluginResult, name, operation, undefined);
    var failFunc = _.partial(logPluginResult, name, operation);
    return promise.tap(succeedFunc).catch(function(error) {
        failFunc(error);
        throw error;
    });
}

function logPluginResult(name, operation, error) {
    if (error === undefined) {
        switch (operation) {
        case 'enable':
            operation = 'Enabled';
            break;
        case 'disable':
            operation = 'Disabled';
            break;
        case 'load':
            operation = 'Loaded';
        }
        log.info(' > ' + operation + ' plugin ' + name);
    } else {
        log.error(' > Failed to ' + operation + ' plugin ' +
        name + ':', error);
    }
}

// Boot step 1: get own identity (functions as API handshake as well)
function getMe() {
    if (config.api.disable) {
        return Promise.resolve();
    }
    logBootStep('Contact Telegram API');
    return bot.api.getMe({}, {cache: false});
}

// Boot step 2: call service init handlers in a way that allows them to depend
// on each other
function initServices() {
    var servicePromises = {};
    logBootStep('Load services (' + serviceNames.length + ')');
    serviceNames.forEach(function(serviceName) {
        var service = services[serviceName];
        var initResult = null;
        if (service.init) {
            initResult = new Promise(function(resolve) {
                process.nextTick(function() {
                    resolve(service.init(
                        _.extend(serviceResources, {
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
                                return serviceFactory(
                                    new botUtil.ServiceConsumerContext(
                                        'service', serviceName
                                    ), targetServiceName
                                );
                            });
                        }
                    ));
                });
            }).tap(function() {
                log.info(' > Loaded service ' + serviceName);
            }).catch(function(error) {
                log.fatal(' > Failed to load service ' +
                serviceName + ':', error);
                throw error;
            });
        } else {
            log.info(' > Loaded service ' + serviceName);
        }
        servicePromises[serviceName] = initResult || Promise.resolve();
    });
    return Promise.props(servicePromises);
}

// Boot step 3: load available plugins
function loadPlugins() {
    var pluginLoadList = plugins.getNames();
    logBootStep('Load plugins (' + pluginLoadList.length + ')');
    var loadPromises = plugins.load(pluginLoadList);
    loadPromises = _.mapValues(loadPromises, function(promise, pluginName) {
        return watchPluginResult(pluginName, 'load', promise);
    });
    return Promise.settle(_.toArray(loadPromises));
}

// Optional boot step: launch express app
function startWebserver() {
    if (!web) {
        return Promise.resolve();
    }
    logBootStep('Starting webserver');
    return web.start();
}

// Boot step 4: enable plugins in enable queue
function enablePlugins() {
    logBootStep('Enable plugins (' + plugins.getEnableQueueSize() + ')');
    var enablePromises = plugins.enableQueued();
    enablePromises = _.mapValues(enablePromises, function(promise, pluginName) {
        return watchPluginResult(pluginName, 'enable', promise);
    });
    return Promise.settle(_.toArray(enablePromises));
}

// Boot step 5: instruct bot client to start polling
function startPoll() {
    if (config.api.disable) {
        return;
    }
    logBootStep('Start long polling loop');
    bot.poll.start();
}

getMe()
    .tap(function(identity) {
        if (identity) {
            log.info(' > My user ID is #' + identity.id);
            log.info(' > My username is @' + identity.username);
            log.info(' > My display name is ' + identity.first_name);
        }
    })
    .catch(function(error) {
        if (config.get('api.mandatoryHandshake')) {
            log.fatal(' > Starting bot failed at the handshake phase:', error);
            process.exit(config.get('exitCodes.botStartFailed'));
        } else {
            log.error(' > API handshake failed:', error);
        }
    })
    .then(initServices)
    .catch(function() {
        process.exit(config.get('exitCodes.botStartFailed'));
    })
    .then(loadPlugins)
    .catch(function(){}) // Plugin errors are non-critical, swallow and continue
    .then(startWebserver)
    .tap(function(port) {
        if (port) {
            log.info(' > Listening on port ' + port);
        }
    })
    .catch(function(error) {
        log.error(' > Starting webserver failed:', error);
        process.exit(config.get('exitCodes.botStartFailed'));
    })
    .then(enablePlugins)
    .catch(function(){})
    .then(startPoll)
    .tap(function() {
        log.info('# Initialization complete #');
    })
    .catch(function (error) {
        log.fatal('Unhandled error during init: ', error);
        process.exit(config.get('exitCodes.botStartFailed'));
    });
