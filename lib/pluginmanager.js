var extend = require('util-extend');
var fs = require('fs');
var path = require('path');
var Q = require('q');
var util = require('util');
var configUtil = require('config').util;
var botUtil = require('./utilities.js');

function PluginManager(plugins, resources) {
    var self = this;
    var log = resources.log;
    var names = plugins.register || [];
    var configOverrides = plugins.config || {};
    var units = {};
    
    this.getUnits = function() { return units; };
    this.getNames = function() { return names; };
    
    this.isLoaded = function(name) {
        return (units[name] && units[name].handlers);
    };
    
    this.isEnabled = function(name) {
        return (units[name] && units[name].enabled);
    };
    
    this.load = function(list) {
        list = list || names;
        return list.map(function(name) {
            return Q.fcall(function() {
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
                unit.handlers = require(unit.moduleFile)(extend({
                    config: unit.config,
                    pjson: unit.pjson
                }, resources));
                units[name] = unit;
                return unit;
            });
        });
    };
    
    this.unload = function(list) {
        list = list || names;
        return list.map(function(name) {
            return Q.fcall(function() {
                var unit = units[name];
                var module = unit.moduleFile;
                delete units[name];
                botUtil.uncacheModule(module);
                return true;
            });
        });
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
                handler.apply(handlers, args);
            }
        });
    };

    this.enable = function(list) {
        return changeState('enable', list);
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
        return list.map(function(name) {
            var unit, handlers, handler;
            return Q.fcall(function() {
                unit = units[name];
                if (!unit) {
                    throw new PluginManager.PluginError(
                        'Plugin "' + name + '" is not loaded', operation
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
                return Q.nfcall(handler.bind(handlers))
                       .catch(function(error) {
                    throw new PluginManager.PluginError(
                        operation + '() call on plugin failed',
                        operation, unit, error
                    );
                });
            })
            .then(function() {
                if (isEnable) {
                    unit.enabled = true;
                }
                return unit;
            }, function(error) {
                if (error === unit) {
                    return unit;
                }
                throw error;
            });
        });
    }
    
}

PluginManager.PluginError = function(message, operation, plugin, error) {
    this.message = message;
    this.operation = operation;
    this.plugin = plugin;
    this.error = error;
    this.stack = error ? error.stack : undefined;
};
util.inherits(PluginManager.PluginError, Error);

module.exports = PluginManager;
