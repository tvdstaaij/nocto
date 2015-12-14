var config = require('config');
var path = require('path');
var Promise = require('bluebird');
var sqlite3 = require('sqlite3');

var svcConfig = config.get('services.config.sqlite');
var db;

module.exports.init = function(resources) {
    if (svcConfig.debug) {
        sqlite3.verbose();
    }
    Promise.promisifyAll(sqlite3);
    var dbFile = path.join(resources.app.root, 'nocto.sqlite3');
    return Promise.fromNode(function(cb) {
        db = new sqlite3.Database(dbFile, cb);
    });
};

module.exports.provides = function() {
    return db;
};
