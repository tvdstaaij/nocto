require('object.observe');
var path = require('path');
var Promise = require('bluebird');
var O = require('observed');
var store = require('store');

var appRoot, log, storage;

module.exports.init = function(resources) {
    log = resources.log;
    appRoot = resources.app.root;
    storage = Promise.promisifyAll(store(path.join(appRoot, 'persist')));
};

module.exports.provides = function(context) {
    var methods = {};
    var storageId = context.name + '.' + context.type;
    var savePromise = Promise.resolve();

    methods.load = function(cb) {
        return storage.loadAsync(storageId).then(function(container) {
                return container;
            }).catch(function() {
                return createStorage();
            }).then(function(container) {
                O(container.data).on('change', function() {
                    savePromise = savePromise.then(function() {
                        return storage.addAsync(container);
                    })
                        .catch(function(error) {
                            log.error('Failed saving persistent storage ' +
                                container.id + ':', error);
                        });
                });
                return container.data;
            }
        ).nodeify(cb);
    };

    function createStorage() {
        var newStorage = {
            id: storageId,
            data: {}
        };
        return storage.addAsync(newStorage).return(newStorage);
    }

    return methods;
};
