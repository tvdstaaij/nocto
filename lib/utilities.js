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
};

exports.makeNativeDate = function(unixTimestamp) {
    return new Date(unixTimestamp * 1000);
};
    
exports.addToObject = function(source, dest, propNames) {
    if (source && dest && propNames) {
        propNames.forEach(function(prop) {
            if (source[prop] !== undefined) {
                dest[prop] = source[prop];
            }
        });
    }
    return dest;
};

exports.uncacheModule = function(moduleName) {
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
