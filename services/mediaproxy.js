var _ = require('lodash');
var config = require('config');
var httpProxy = require('http-proxy');
var Promise = require('bluebird');
var url = require('url');
var mime = require('mime-types');
var botUtil = require('../lib/utilities.js');

var svcConfig = _.get(config, 'services.config.mediaproxy') || {};
var proxy = httpProxy.createProxyServer();
var permalinks = {};
var api, log, stickerCodec;

module.exports.init = function(resources, service) {
    api = resources.bot.api;
    log = resources.log;
    var app = _.get(resources.web, 'app');
    var fileInfoCache;

    function handleMediaRequest(req, res, next) {
        var id = req.params.id;
        var extensionDot = id.lastIndexOf('.');
        if (extensionDot > 0) {
            id = id.substr(0, extensionDot);
        }

        var hooks = [];
        var mimeType = mime.lookup(req.originalUrl);
        if (mimeType) {
            hooks.push(_.partial(rewriteResponseHeaders,
                {'content-type': mimeType}));
        }
        if (svcConfig.decodeWebp &&
            _.endsWith(req.originalUrl.toLowerCase(), '.webp.png')) {
            hooks.push({func: decodeWebp, buffer: true});
        }
        installResponseHooks(res, hooks);

        fileInfoCache.resolve(id)
            .then(function(fileInfo) {
                var targetUriComponents = url.parse(api.getFileUri(fileInfo));
                req.url = targetUriComponents.path;
                req.headers = _.omit(req.headers, [
                    'cookie', 'dnt', 'accept', 'upgrade-insecure-requests',
                    'accept-language', 'origin', 'upgrade', 'via', 'referer'
                ]);
                req.headers = _.omit(req.headers, function(value, header) {
                    return _.endsWith(header, 'authorization') ||
                        _.startsWith(header, 'x-');
                });
                req.headers['user-agent'] = resources.app.identifier;
                proxy.web(req, res, proxyOptions);
            })
            .catch(function(error) {
                log.error(error);
                next(error);
            });
    }

    var proxyOptions = {
        changeOrigin: true,
        agent: resources.bot.agent,
        target: (function() {
            var baseUriComponents = url.parse(config.get('api.baseUri'));
            return baseUriComponents.protocol + '//' + baseUriComponents.host;
        })(),
        secure: config.get('api.strictSSL')
    };

    proxy.on('error', function(err, req, res) {
        res.status = 502;
        res.end('Bad Gateway');
        log.error(err);
    });

    return botUtil.loadServiceDependencies([
            'fileinfocache', 'stickercodec'
        ], service)
        .then(function(services) {
            fileInfoCache = services.fileinfocache;
            stickerCodec = services.stickerCodec;
            if (!app) {
                log.warn('web.enabled=false, not serving any files');
                return;
            }
            app.get('/media/:id*', handleMediaRequest);
        });
};

module.exports.handleMessage = function(message, meta) {
    var chatId = message.chat.id;
    var command = meta.command;
    if (String(_.get(command, 'name')) === 'permalink') {
        var requiredAuthority = _.get(svcConfig, 'privileges.permalink');
        if (!requiredAuthority ||
            (meta.authority && meta.authority.isAtLeast(requiredAuthority))) {
            return servePermalink(chatId, command.argumentTokens[0]);
        }
    }

    var media = botUtil.extractMediaObject(message);
    if (!media) {
        return;
    }
    var file = _.isArray(media.object) ? _.last(media.object) : media.object;
    if (!_.isObject(file)) {
        return;
    }
    var uri = config.get('web.baseUri') + '/media/' + file.file_id;

    var audioMetaProps = [];
    _.forEach(['performer', 'title'], function(metaProp) {
        if (_.isString(file[metaProp])) {
            audioMetaProps.push(file[metaProp]);
        }
    });
    if (!_.isEmpty(audioMetaProps)) {
        uri += '/' + encodeURIComponentPlus(audioMetaProps.join(' - '));
    }

    meta.permalink = uri + makeFileSuffix(media);
    permalinks[chatId] = permalinks[chatId] || [];
    permalinks[chatId].push(meta.permalink);
};

function servePermalink(chatId, offset) {
    offset = Number(offset || 0);
    var scopedPermalinks = permalinks[chatId];
    if (!_.isFinite(offset) || _.isEmpty(scopedPermalinks)) {
        return;
    }
    offset = Math.abs(offset);
    var index = scopedPermalinks.length - offset - 1;
    if (index < 0 || !scopedPermalinks[index]) {
        return;
    }
    return new api.MessageBuilder(chatId).text(scopedPermalinks[index]).send();
}

function rewriteResponseHeaders(rewrites, res) {
    _.forEach(rewrites, function(value, header) {
        res.setHeader(header, value);
    }, this);
}

function decodeWebp(res, status) {
    res.removeHeader('accept-ranges');
    if (status !== 200) {
        res.removeHeader('content-type');
        return;
    }

    var buf = new Buffer(0);
    var _write = res.write;
    var _end = res.end;

    function flushResponse(data) {
        res.write = _write;
        _end.call(res, data);
    }

    res.write = function(data) {
        if (Buffer.isBuffer(data)) {
            buf = Buffer.concat([buf, data]);
        }
    };

    return new Promise(function(resolve) {
        res.end = function(data, encoding) {
            if (data) {
                res.write(data, encoding);
            }
            if (res.statusCode !== 200) {
                return resolve({
                    postHeaderFlush: _.partial(flushResponse, buf)
                });
            }

            var decodePromise = stickerCodec.decode(buf)
                .then(function(result) {
                    res.setHeader('content-length', result.length);
                    res.setHeader('content-type', 'image/png');
                    res.removeHeader('transfer-encoding');
                    return {
                        postHeaderFlush: _.partial(flushResponse, result)
                    };
                })
                .catch(function(error) {
                    log.error('Decode error:', error);
                    res.setHeader('content-type', 'text/html');
                    var payload = new Buffer('Internal Server Error');
                    res.setHeader('content-length', payload.length);
                    return {
                        status: 500,
                        postHeaderFlush:
                            _.partial(flushResponse, payload)
                    };
                });
            resolve(decodePromise);
        };
    });
}

function installResponseHooks(res, hooks) {
    if (_.isEmpty(hooks)) {
        return;
    }
    var _writeHead = res.writeHead;
    var _end = res.end;
    var endArgs = null;

    res.writeHead = _.once(function(status) {
        var postponeHeaders = false;
        var promises = _.map(hooks, function(hook) {
            if (hook.buffer) {
                postponeHeaders = true;
                res.end = function() {
                    endArgs = arguments;
                };
            }
            hook = _.isFunction(hook) ? hook : hook.func;
            return hook.call(res, res, status);
        });
        var writeHeadArgs = arguments;
        if (!postponeHeaders) {
            _writeHead.apply(res, writeHeadArgs);
        }
        Promise.settle(promises)
            .then(function(results) {
                _.forEach(results, function(result) {
                    if (result.isFulfilled()) {
                        var value = result.value();
                        if (_.get(value, 'status')) {
                            writeHeadArgs[0] = value.status;
                        }
                    }
                });
                if (postponeHeaders) {
                    _writeHead.apply(res, writeHeadArgs);
                }
                _.forEach(results, function(result) {
                    if (result.isFulfilled()) {
                        var value = result.value();
                        if (_.get(value, 'postHeaderFlush')) {
                            value.postHeaderFlush.call(res);
                        }
                    }
                });
                if (postponeHeaders) {
                    if (endArgs) {
                        _end.apply(res, endArgs);
                    } else {
                        _end.call(res);
                    }
                }
            });
    });
}

function encodeURIComponentPlus(component) {
    return encodeURIComponent(component).replace(/%20/g, '+');
}

function makeFileSuffix(media) {
    var suffix = '';
    var file = media.object;
    var type = media.type;

    // Strategy 1: use real filename if known
    if (_.isString(file.file_name)) {
        suffix = '/' + encodeURIComponentPlus(file.file_name);
    }

    // Strategy 2: use mime type to find an appropriate extension if it is known
    var preferredExtensions = ['mp3', 'ogg', 'jpg'];
    if (!suffix && _.isString(file.mime_type)) {
        var extensions = mime.extensions[file.mime_type] || [];
        var preferredMatches = _.intersection(extensions, preferredExtensions);
        if (!_.isEmpty(preferredMatches)) {
            suffix = '.' + _.first(preferredMatches);
        } else if (!_.isEmpty(extensions)) {
            suffix = '.' + _.first(extensions);
        } else {
            suffix = file.mime_type.replace(/^[^\/]*\//, '.');
        }
    }

    // Strategy 3: guess appropriate extension based on Telegram media type
    if (!suffix && type === 'sticker') {
        suffix = '/sticker.webp';
        if (svcConfig.decodeWebp) {
            suffix += '.png';
        }
    }
    if (!suffix && type === 'photo') {
        suffix = '.jpg';
    }
    if (!suffix && type === 'voice') {
        suffix = '.opus';
    }

    return suffix;
}
