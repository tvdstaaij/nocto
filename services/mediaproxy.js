var _ = require('lodash');
var config = require('config');
var httpProxy = require('http-proxy');
var url = require('url');
var mime = require('mime-types');
var botUtil = require('../lib/utilities.js');

var proxy = httpProxy.createProxyServer();

module.exports.init = function(resources) {
    var api = resources.bot.api;
    var app = resources.web.app;
    var log = resources.log;

    function handleMediaRequest(req, res, next) {
        var id = req.params.id;
        var extensionDot = id.lastIndexOf('.');
        if (extensionDot > 0) {
            id = id.substr(0, extensionDot);
        }
        var mimeType = mime.lookup(req.originalUrl);
        if (mimeType) {
            rewriteResponseHeaders(res, {'content-type': mimeType});
        }

        api.getFile({file_id: id})
            .then(function(fileInfo) {
                var targetUriComponents = url.parse(api.getFileUri(fileInfo));
                req.url = targetUriComponents.path;
                proxy.web(req, res, proxyOptions);
            })
            .catch(_.ary(next, 0));
    }

    var proxyOptions = {
        changeOrigin: true,
        agent: resources.bot.agent,
        target: (function() {
            var baseUriComponents = url.parse(config.get('api.baseUri'));
            return baseUriComponents.protocol + '//' + baseUriComponents.host;
        })()
    };

    proxy.on('error', function(err, req, res) {
        res.status = 502;
        res.end('Bad Gateway');
        log.error(err);
    });

    app.get('/media/:id*', handleMediaRequest);
};

module.exports.handleMessage = function(message, meta) {
    var media = botUtil.extractMediaObject(message);
    if (!media) {
        return;
    }
    var file = _.isArray(media.object) ? _.last(media.object) : media.object;
    if (!_.isObject(file)) {
        return;
    }
    var uri = config.get('web.baseUri') + '/media/' + file.file_id;
    _.forEach(['performer', 'title'], function(metaProp) {
        if (_.isString(file[metaProp])) {
            uri += '/' + encodeURIComponentPlus(file[metaProp]);
        }
    });

    var suffix = '';
    if (_.isString(file.file_name)) {
        suffix = '/' + file.file_name;
    }
    if (!suffix && media.type === 'voice' &&
        _.endsWith(file.mime_type, 'ogg')) {
        suffix = '.ogg';
    }
    if (!suffix && _.isString(file.mime_type)) {
        var extension = mime.extension(file.mime_type);
        if (_.isString(extension)) {
            suffix = '.' + extension;
        } else {
            suffix = file.mime_type.replace(/^[^\/]*\//, '.');
        }
    }
    if (!suffix && media.type === 'sticker') {
        suffix = '.webp';
    }
    if (!suffix && media.type === 'photo') {
        suffix = '.jpg';
    }
    if (!suffix && media.type === 'voice') {
        suffix = '.opus';
    }
    meta.permalink = uri + suffix;
};

function rewriteResponseHeaders(res, rewrites) {
    var _writeHead = res.writeHead;
    res.writeHead = function(statusCode, headers) {
        _.forEach(rewrites, function(value, header) {
            res.setHeader(header, value);
        });
        _writeHead.call(res, statusCode, headers);
    };
}

function encodeURIComponentPlus(component) {
    return encodeURIComponent(component).replace(/%20/g, '+');
}
