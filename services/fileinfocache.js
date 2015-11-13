var _ = require('lodash');
var config = require('config');
var Promise = require('bluebird');

var svcConfig = config.get('services.config.fileinfocache');
var cache = {};
var methods = {};

module.exports.init = function(resources) {
    var api = resources.bot.api;
    methods.resolve = function(id) {
        var cacheEntry = cache[id];
        var expires = Number(svcConfig.expires) * 1000;
        if (cacheEntry && new Date() - cacheEntry.date < expires) {
            return Promise.resolve(cacheEntry.object);
        } else {
            return api.getFile({file_id: id})
                .tap(function(fileInfo) {
                    cache[id] = {
                        object: fileInfo,
                        date: new Date()
                    };
                });
        }
    };
};

module.exports.provides = _.constant(methods);
