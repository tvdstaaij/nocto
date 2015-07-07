var log4js = require('log4js');
var path = require('path');
var O = require('observed');
var store = require('store');
var Q = require('q');
var botUtil = require('../lib/utilities.js');

var appRoot = botUtil.getAppRoot();
var storage = store(path.join(appRoot, 'persist'));
var log = log4js.getLogger('services');

module.exports.provides = function(context) {
    var methods = {};
    var storageId = context.name + '.' + context.type;

    methods.load = function(cb) {
        return loadStorage().then(
            function(container) {
                return container;
            },
            function() {
                return createStorage();
            }
        ).then(
            function(container) {
                O(container.data).on('change', function() {
                    saveStorage(container).catch(function(error) {
                        log.error('Failed saving persistent storage ' +
                                  container.id + ':', error);
                    }).done();
                });
                return container.data;
            }
        ).nodeify(cb);
    };

    function loadStorage() {
        return Q.nfcall(storage.load, storageId);
    }

    function createStorage() {
        var newStorage = {
            id: storageId,
            data: {}
        };
        return Q.nfcall(storage.add, newStorage).then(function() {
            return newStorage;
        });
    }

    function saveStorage(container) {
        return Q.nfcall(storage.add, container);
    }

    return methods;
};
