var _ = require('lodash');
var config = require('config');
var httpProxy = require('http-proxy');
var Promise = require('bluebird');
var url = require('url');
var mime = require('mime-types');
var base64url = require('base64url');
var crypto = require('crypto');
var botUtil = require('../lib/utilities.js');

var svcConfig = _.get(config, 'services.config.mediaproxy') || {};
var proxy = httpProxy.createProxyServer();
var permalinks = {};
var api, log, encryptionKey;

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
        if (svcConfig.encryptFileId) {
            id = decryptFileId(id);
        }

        var hooks = [];
        var mimeType = mime.lookup(req.originalUrl);
        if (mimeType) {
            hooks.push(_.partial(rewriteResponseHeaders, {
              'content-type': mimeType,
              'content-disposition': 'inline'
            }));
        }
        installResponseHooks(res, hooks);

        fileInfoCache.resolve(id)
            .then(function(fileInfo) {
                var targetUriComponents = url.parse(api.getFileUri(fileInfo));
                req.url = targetUriComponents.path;
                req.headers = _.pick(req.headers, [
                  'if-modified-since', 'if-none-match', 'cache-control',
                  'if-range', 'range', 'accept-encoding'
                ]);
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
        secure: config.get('api.strictSSL'),
        xfwd: false
    };

    proxy.on('error', function(err, req, res) {
        res.status = 502;
        res.end('Bad Gateway');
        log.error(err);
    });

    var serviceDependencies = ['fileinfocache'];
    if (svcConfig.encryptFileId) {
      serviceDependencies.push('persist');
    }
    return botUtil.loadServiceDependencies(serviceDependencies, service)
        .then(function(services) {
            fileInfoCache = services.fileinfocache;
            if (!app) {
                log.warn('web.enabled=false, not serving any files');
                return;
            }
            app.get('/media/:id*', handleMediaRequest);
            if (services.persist) {
               return loadPersistentData(services.persist);
            }
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
    var fileId = svcConfig.encryptFileId ?
        encryptFileId(file.file_id) : file.file_id;
    var uri = config.get('web.baseUri') + '/media/' + fileId;

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

    if (svcConfig.autoPermalink) {
      servePermalink(chatId);
    }
};

function loadPersistentData(persist) {
    return Promise.try(function() {
        return persist.load();
    })
    .then(function(container) {
        if (!container.encryptionKey) {
            container.encryptionKey = crypto.randomBytes(16).toString('base64');
        }
        encryptionKey = Buffer.from(container.encryptionKey, 'base64');
    });
}

function encryptFileId(fileId) {
    var binaryFileId = base64url.toBuffer(fileId);
    var iv = crypto.randomBytes(16);
    var cipher = crypto.createCipheriv('aes-128-cbc', encryptionKey, iv);
    var encryptedFileId = Buffer.concat([
        iv, cipher.update(binaryFileId), cipher.final()
    ]);
    return base64url.encode(encryptedFileId);
}

function decryptFileId(fileId) {
    var encryptedFileId = base64url.toBuffer(fileId);
    var iv = encryptedFileId.slice(0, 16);
    var cipherText = encryptedFileId.slice(16);
    var cipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
    var decryptedFileId = Buffer.concat([
        cipher.update(cipherText), cipher.final()
    ]);
    return base64url.encode(decryptedFileId);
}

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
    return new api.MessageBuilder(chatId)
        .text(scopedPermalinks[index])
        .webPreview(false)
        .send();
}

function rewriteResponseHeaders(rewrites, res) {
    _.forEach(rewrites, function(value, header) {
        if (_.inRange(res.statusCode, 200, 300)) {
            res.setHeader(header, value);
        }
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
            suffix = '.' + _.head(preferredMatches);
        } else if (!_.isEmpty(extensions)) {
            suffix = '.' + _.head(extensions);
        } else {
            suffix = file.mime_type.replace(/^[^\/]*\//, '.');
        }
    }

    // Strategy 3: guess appropriate extension based on Telegram media type
    if (!suffix && type === 'sticker') {
        suffix = '/sticker.webp';
    }
    if (!suffix && type === 'photo') {
        suffix = '.jpg';
    }
    if (!suffix && type === 'voice') {
        suffix = '.opus';
    }

    return suffix;
}
