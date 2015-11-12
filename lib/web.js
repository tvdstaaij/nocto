var _ = require('lodash');
var Promise = require('bluebird');
var config = require('config').web;
var log4js = require('log4js');
var express = require('express');
var util = require('util');
var http = Promise.promisifyAll(require('http'));

var log = log4js.getLogger('nocto');
var self = this;

var app = express();
app.disable('x-powered-by');
self.app = app;

function HttpError(message, status) {
    Error.captureStackTrace(this, HttpError);
    this.status = Number(status) || 500;
    this.message = String(message) || 'Unspecified error';
}
util.inherits(HttpError, Error);
self.HttpError = HttpError;

self.start = function() {
    finalizeApp();
    var server = self.server = http.createServer(app);
    server.on('error', console.error.bind(console));
    var promise = new Promise(function(resolve, reject) {
        server.on('listening', resolve);
        server.on('error', reject);
    });
    server.listen(config.port);
    return promise.return(config.port);
};

self.stop = function() {
    return self.server.closeAsync();
};

self.toPluginResource = function() {
    return {
        app: app,
        HttpError: HttpError
    };
};
self.toServiceResource = self.toPluginResource;

function finalizeApp() {
    app.use(function(req, res, next) {
        next(new HttpError('404 Not Found', 404));
    });
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.end(err.message);
    });
}
