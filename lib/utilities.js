var _ = require('lodash');
var Promise = require('bluebird');

function searchModuleCache(moduleName, callback) {
    // Resolve the module identified by the specified name
    var mod = require.resolve(moduleName);

    // Check if the module has been resolved and found within
    // the cache
    if (mod && ((mod = require.cache[mod]) !== undefined)) {
        // Recursively go over the results
        (function run(mod) {
            // Go over each of the module's children and
            // run over it
            mod.children.forEach(function (child) {
                run(child);
            });

            // Call the specified callback providing the
            // found module
            callback(mod);
        })(mod);
    }
}

module.exports.makeNativeDate = function(unixTimestamp) {
    return new Date(unixTimestamp * 1000);
};

module.exports.extractMediaObject = function(message) {
    var types = ['audio', 'document', 'photo', 'sticker', 'video', 'voice'];
    var result = null;
    _.forEach(types, function(type) {
        var object = _.get(message, type);
        if (object) {
            result = {type: type, object: object};
        }
    });
    return result;
};

module.exports.uncacheModule = function(moduleName) {
    // Run over the cache looking for the files
    // loaded by the specified module name
    searchModuleCache(moduleName, function (mod) {
        delete require.cache[mod.id];
    });

    // Remove cached paths to the module.
    // Thanks to @bentael for pointing this out.
    Object.keys(module.constructor._pathCache).forEach(function(cacheKey) {
        if (cacheKey.indexOf(moduleName)>0) {
            delete module.constructor._pathCache[cacheKey];
        }
    });
};

module.exports.loadServiceDependencies = function(serviceNames, factory) {
    var promises = [], services = {};
    serviceNames.forEach(function(serviceName) {
        promises.push(factory(serviceName).then(
            (function(name, service) {
                services[name] = service;
            }).bind(undefined, serviceName)
        ));
    });
    return Promise.all(promises).return(services);
};

function ServiceConsumerContext(type, name) {
    this.type = type;
    this.name = name;
}
ServiceConsumerContext.prototype.toString = function() {
    return this.type + '/' + this.name;
};
module.exports.ServiceConsumerContext = ServiceConsumerContext;
