var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var log4js = require('log4js');
var path = require('path');
var Promise = require('bluebird');
var util = require('util');
var configUtil = require('config').util;
var botUtil = require('./utilities.js');

function PluginManager(plugins, resources, serviceFactory) {
    resources = resources || {};
    var self = this;
    var log = log4js.getLogger('plugins');
    var names = composePluginList();
    var configOverrides = plugins.config || {};
    var units = {};
    var enableQueue = [];
    
    this.getUnits = function() { return units; };
    this.getNames = function() { return names; };
    this.getEnableQueueSize = function() { return enableQueue.length; };

    this.isLoaded = function(name) {
        return (units[name] && units[name].handlers);
    };
    
    this.isEnabled = function(name) {
        return (units[name] && units[name].enabled);
    };
    
    this.load = function(list) {
        list = list || names;
        return _(list).invert().mapValues(function(index, name) {
            return Promise.try(function() {
                if (units[name]) {
                    throw new PluginManager.PluginError(
                        'Plugin "' + name + '" is already loaded', 'load',
                        name, 'already_loaded'
                    );
                }
                var unit = {
                    name: name,
                    path: path.join(plugins.basePath, name),
                    enabled: false
                };
                unit.moduleFile = path.join(unit.path, name + '.js');
                unit.configFile = path.join(unit.path, 'config.json');
                unit.packageFile = path.join(unit.path, 'package.json');
                try {
                    unit.pjson = JSON.parse(
                        fs.readFileSync(unit.packageFile, 'utf8')
                    );
                } catch (error) {
                    if (error && error.code === 'ENOENT') {
                        unit.pjson = null;
                    } else {
                        throw error;
                    }
                }
                try {
                    unit.config = JSON.parse(configUtil.stripComments(
                    fs.readFileSync(unit.configFile, 'utf8'))
                    );
                } catch (error) {
                    if (error && error.code === 'ENOENT') {
                        unit.config = null;
                    } else {
                        throw error;
                    }
                }
                if (unit.config && configOverrides[name]) {
                    configUtil.extendDeep(unit.config, configOverrides[name]);
                }
                unit.handlers = require(unit.moduleFile)(
                _.extend({
                    config: unit.config,
                    pjson: unit.pjson,
                    log: log4js.getLogger(name)
                }, resources),
                serviceFactory.bind(
                    undefined, new botUtil.ServiceConsumerContext(
                        'plugin', name
                    )
                ));
                units[name] = unit;
                self.emit('pluginLoaded', unit);
                return unit;
            }).catch(_.partial(function(name, error) {
                self.emit('pluginLoadFailed', name, error);
                throw error;
            }, name));
        }).value();
    };
    
    this.unload = function(list) {
        list = list || names;
        return _(list).invert().mapValues(function(index, name) {
            return Promise.try(function() {
                var unit = units[name];
                if (!unit) {
                    throw new PluginManager.PluginError(
                        'Plugin "' + name + '" is not loaded', 'unload',
                        name, 'not_loaded'
                    );
                }
                var module = unit.moduleFile;
                delete units[name];
                botUtil.uncacheModule(module);
                self.emit('pluginUnloaded', name);
                return true;
            });
        }).value();
    };
    
    this.invokeHandler = function(handlerName, options, args) {
        options = options || {};
        args = args || [];
        names.forEach(function(name) {
            var unit = units[name];
            if (!unit || (!unit.enabled && options.requireEnabled !== false)) {
                return;
            }
            var handlers = unit.handlers;
            var handler = handlers[handlerName];
            if (handler) {
                try {
                    handler.apply(handlers, args);
                } catch (error) {
                    log.error('Plugin ' + name + ' failed to handle message:',
                              error);
                }
            }
        });
    };

    this.enable = function(list) {
        return changeState('enable', list);
    };

    this.enableLater = function(list) {
        enableQueue = _.union(enableQueue, list);
    };

    this.enableQueued = function() {
        var result = changeState('enable', enableQueue);
        enableQueue = [];
        return result;
    };
    
    this.disable = function(list) {
        return changeState('disable', list);
    };
    
    function changeState(operation, list) {
        if (operation !== 'enable' && operation !== 'disable') {
            throw new PluginManager.PluginError(
                'Illegal changeState operation',
                operation
            );
        }
        var isEnable = (operation === 'enable');
        
        list = list || names;
        return _(list).invert().mapValues(function(index, name) {
            var unit, handlers, handler;
            return Promise.try(function() {
                unit = units[name];
                if (!unit) {
                    throw new PluginManager.PluginError(
                        'Plugin "' + name + '" is not loaded', operation,
                        name, 'not_loaded'
                    );
                }
                handlers = unit.handlers;
                handler = isEnable ? handlers.enable : handlers.disable;
                if ((isEnable && unit.enabled) ||
                    (!isEnable && !unit.enabled)) {
                    throw unit; // Plugin already enabled/disabled exception
                }
                if (!isEnable) {
                    unit.enabled = false;
                }
                if (handler === undefined) {
                    return true;
                }
                handler = Promise.promisify(handler, handlers);
                return handler().catch(function(error) {
                    throw new PluginManager.PluginError(
                        operation + '() call on plugin failed',
                        operation, unit, error
                    );
                });
            }).then(function() {
                if (isEnable) {
                    unit.enabled = true;
                }
                self.emit('pluginEnabled', unit);
                return unit;
            }).catch(function(error) {
                if (error === unit) {
                    return unit;
                }
                self.emit('pluginEnableFailed', unit, error);
                throw error;
            });
        }).value();
    }

    function composePluginList() {
        if (plugins.loadAll !== true) {
            return plugins.register || [];
        }
        var baseDir = 'plugins';
        return _.reduce(fs.readdirSync(baseDir), function(list, candidate) {
            if (!_.startsWith(candidate, '.')) {
                var stat = fs.statSync(baseDir + '/' + candidate);
                if (stat.isDirectory()) {
                    list.push(candidate);
                }
            }
            return list;
        }, []);
    }
    
}
util.inherits(PluginManager, EventEmitter);

PluginManager.PluginError = function(message, operation, plugin, error) {
    this.message = message;
    this.operation = operation;
    this.plugin = plugin;
    this.error = error;
};
util.inherits(PluginManager.PluginError, Error);

module.exports = PluginManager;
