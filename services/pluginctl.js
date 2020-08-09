var _ = require('lodash');
var Promise = require('bluebird');
var botUtil = require('../lib/utilities.js');

var api, log, bot, pluginManager, pluginList, pluginConfig, storage, emoji,
    pluginData;

module.exports.init = function(resources, service) {
    var persist;
    api = resources.bot.api;
    log = resources.log;
    bot = resources.bot;
    pluginManager = resources.plugins;
    pluginConfig = resources.config.get('plugins');
    pluginList = pluginManager.getNames();

    return botUtil.loadServiceDependencies(['persist', 'emoji'], service)
    .then(function(services) {
        persist = services.persist;
        emoji = services.emoji;
    })
    .then(function() {
        return persist.load();
    })
    .then(function(container) {
        storage = container;
        storage.plugins = storage.plugins || {};
        pluginData = storage.plugins;
        _.forEach(pluginData, function(pluginRecord, pluginName) {
            if (!_.includes(pluginList, pluginName)) {
                pluginRecord.enabled = false;
            }
            if (pluginRecord.enabled === true) {
                pluginManager.enableLater([pluginName]);
            }
        });
        _.forEach(pluginList, function(pluginName) {
            pluginData[pluginName] = pluginData[pluginName] || {
                enabled: false
            };
        });
    });
};

module.exports.handleMessage = function(message, meta) {
    var command = meta.command;
    if (!meta.fresh || !command || !/^plugins?$/i.test(command.name)) {
        return;
    }
    var reply = new api.MessageBuilder(message.chat.id)
        .replyIfKeyboard(message.message_id);
    var operation = command.argumentTokens[0].toLowerCase();
    var argument = command.argumentTokens.slice(1);
    switch (operation) {
    case 'load':
    case 'unload':
    case 'reload':
    case 'enable':
    case 'disable':
    case 'reenable':
        if (!checkPrivilege(meta.authority, '&', reply)) return;
        performOperation(operation, argument, reply);
        break;
    case 'list':
    case 'status':
        if (!checkPrivilege(meta.authority, '+', reply)) return;
        showStatus(reply);
    }
};

function performOperation(operation, pluginNames, reply) {
    var persistentAction = api.sendPersistentChatAction(
        reply.action('typing').build()
    );
    var reports = [], cleanPluginNames = [];
    if ((pluginNames.length === 1 && pluginNames[0].toLowerCase() === 'all') ||
        (pluginNames.length === 0 && operation.indexOf('re') === 0)) {
        cleanPluginNames = pluginList.slice(0);
    } else {
        cleanPluginNames = _(pluginNames).invokeMap(String.prototype.trim)
            .compact().filter(function(pluginName) {
                if (!_.has(pluginData, pluginName)) {
                    reports.push('Plugin "' + pluginName + '" not found');
                    return false;
                }
                if (operation === 'enable') {
                    pluginData[pluginName].enabled = true;
                }
                if (operation === 'disable') {
                    pluginData[pluginName].enabled = false;
                }
                return true;
            }).value();
    }
    Promise.try(function() {
        if (operation === 'reload' || operation === 'disable' ||
            operation === 'reenable' || operation === 'unload') {
            var disableQueue = _.filter(
                cleanPluginNames, pluginManager.isLoaded
            );
            if (!disableQueue.length) {
                return;
            }
            return invokePluginOperation(
                pluginManager.disable, [disableQueue]
            );
        }
    }).then(function(promises) {
        reports.push(makeOperationReport('disable', promises));
        cleanPluginNames = removeFailedPlugins(operation, cleanPluginNames,
                                               promises);
        if (operation === 'reload' || operation === 'unload') {
            return invokePluginOperation(
                pluginManager.unload, [cleanPluginNames]
            );
        }
    }).then(function(promises) {
        reports.push(makeOperationReport('unload', promises));
        cleanPluginNames = removeFailedPlugins(operation, cleanPluginNames,
                                               promises);
        if (operation === 'reload' || operation === 'load' ||
            operation === 'enable') {
            var enableQueue = operation === 'load' ? cleanPluginNames :
                _.filter(
                    cleanPluginNames, _.negate(pluginManager.isLoaded)
                );
            if (!enableQueue.length) {
                return;
            }
            return invokePluginOperation(
                pluginManager.load, [enableQueue]
            );
        }
    }).then(function(promises) {
        reports.push(makeOperationReport('load', promises));
        cleanPluginNames = removeFailedPlugins(operation, cleanPluginNames,
                                               promises);
        cleanPluginNames = _.filter(cleanPluginNames, hasEnablePermission);
        if (operation === 'reload' || operation === 'enable' ||
            operation === 'reenable') {
            return invokePluginOperation(
                pluginManager.enable, [cleanPluginNames]
            );
        }
    }).then(function(promises) {
        reports.push(makeOperationReport('enable', promises));
    }).finally(function() {
        persistentAction.cancel();
        var reportText = _.compact(reports).join("\n") ||
            'No operation performed';
        api.sendMessage(reply.text(reportText).build());
    });
}

function removeFailedPlugins(operation, pluginNames, promises) {
    if (!pluginNames || !promises) return pluginNames;
    return _.filter(pluginNames, function(pluginName) {
        var promise = promises[pluginName];
        return !promise ||
            (promise.isFulfilled() ||
             isRedundantLoadResult(operation, promise.reason()));
    });
}

function invokePluginOperation(func, args) {
    var promises = func.apply(pluginManager, args);
    return Promise.settle(_.toArray(promises)).return(promises);
}

function showStatus(reply) {
    var header = '';
    var reports = [];
    if (pluginList.length) {
        header = "Ld/En/Name\n";
    } else {
        header = 'No plugins are registered with the bot.';
    }
    _.forEach(pluginList, function(pluginName) {
        var loaded = false, enabled = false;
        var unit = pluginManager.getUnits()[pluginName];
        if (unit) {
            loaded = true;
            if (unit.enabled) {
                enabled = true;
            }
        }
        reports.push(getEmojiForBoolean(loaded) + getEmojiForBoolean(enabled) +
                     ' ' + pluginName);
    });
    api.sendMessage(reply.text(header + reports.join("\n")).build());
}

function hasEnablePermission(pluginName) {
    if (_.includes(pluginConfig.autoEnabled, pluginName)) {
        return true;
    }
    var record = pluginData[pluginName];
    return record && record.enabled === true;
}

function makeOperationReport(operation, promises) {
    var reports = [];
    if (_.isObject(promises)) {
        _.forEach(promises, function(promise, pluginName) {
            var success = promise.isFulfilled();
            var result = success ? promise.value() : promise.reason();
            if (!success && isRedundantLoadResult(operation, result)) {
                success = true;
            }
            if (!success) {
                log.error('Failed to ' + operation + ' ' + pluginName +
                          ':', promise.reason());
            }
            reports.push(
                getEmojiForBoolean(success) + ' ' +
                _.upperFirst(operation) + ' ' + pluginName +
                (success ? '' : ' (error details logged)')
            );
        });
    }
    return reports.join("\n");
}

function isRedundantLoadResult(operation, result) {
    return _.isObject(result) && result.error &&
        _.endsWith(operation, 'load') && _.endsWith(result.error, 'loaded');
}

function getEmojiForBoolean(bool) {
    return emoji.data.from_short_name(
        bool ? 'heavy_check_mark' : 'x'
    ).render();
}

function checkPrivilege(authority, requirement, reply) {
    if (!authority || !authority.isAtLeast(requirement)) {
        api.sendMessage(reply.text(
            'Sorry, you are not authorized to perform this operation.'
        ).build());
        return false;
    }
    return true;
}
