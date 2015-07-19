var Entities = require('html-entities').AllHtmlEntities;
var Promise = require('bluebird');
var request = require('request');

var api, app, config, log, entities;
var handlers = {}, offsets = {};
var maxOffset = 0;

module.exports = function loadPlugin(resources) {
    api = resources.api;
    config = resources.config;
    app = resources.app;
    log = resources.log;
    entities = new Entities();
    maxOffset = (config.parallelDownloads + 1) * (config.queryRepeatLimit - 1);
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    var command = meta.command;
    if (!meta.fresh || !command) {
        return;
    }
    var commandRegex = /^(g|google)?(images|img)s?[^a-z]*([a-z]*)$/i;
    var match = command.name.match(commandRegex);
    var query = command.argument;
    if (match && query) {
        var offset = calculateOffset(message.chat.id, query);
        if (offset === -1) {
            return;
        } else if (maxOffset && offset > maxOffset) {
            api.sendMessage({
                chat_id: message.chat.id,
                reply_to_message_id: message.message_id,
                text: "I'm getting bored, try a different query"
            });
            return;
        }
        api.sendChatAction({
            chat_id: message.chat.id,
            action: 'upload_photo'
        });
        searchImages(query, match[3] || config.defaultLanguage, offset).then(
            function(results) {
                getFastestImage(results).then(function(winner) {
                    api.sendPhoto({
                        chat_id: message.chat.id,
                        reply_to_message_id: message.message_id,
                        caption: entities.decode(
                            winner.candidate.titleNoFormatting
                        ),
                        photo: winner.fileUpload
                    }, {
                        fileUpload: true
                    }).catch(function(error) {
                        log.error('Failed to upload image to Telegram:', error);
                        api.sendMessage({
                            chat_id: message.chat.id,
                            reply_to_message_id: message.message_id,
                            text: 'Failed to upload image to Telegram'
                        });
                    });
                }).catch(function() {
                    api.sendMessage({
                        chat_id: message.chat.id,
                        reply_to_message_id: message.message_id,
                        text: 'Failed to download image'
                    });
                });
            }
        ).catch(function(error) {
                log.error('Failed to fetch search results:', error);
                api.sendMessage({
                    chat_id: message.chat.id,
                    reply_to_message_id: message.message_id,
                    text: 'Failed to fetch image search results'
                });
            }
        );
    }
};

function calculateOffset(chatId, query) {
    offsets[chatId] = offsets[chatId] || {};
    var chatOffsets = offsets[chatId];
    if (chatOffsets[query] !== undefined) {
        if (maxOffset && chatOffsets[query] > maxOffset) {
            return -1;
        }
        // Google seems to be including the last result of the previous page
        // as the first result of the page after that, so offset one extra
        chatOffsets[query] += config.parallelDownloads + 1;
    } else {
        chatOffsets[query] = 0;
    }
    return chatOffsets[query];
}

function searchImages(query, language, offset) {
    offset = offset || 0;
    var reqOptions = {
        method: 'GET',
        uri: 'https://ajax.googleapis.com/ajax/services/search/images',
        gzip: true,
        json: true,
        strictSSL: true,
        headers: {
            'Accept': 'application/json,text/javascript',
            'User-Agent': app.identifier
        },
        qs: {
            v: '1.0',
            q: query,
            hl: language.substr(0, 2),
            rsz: config.parallelDownloads,
            safe: config.safeSearch,
            start: offset
        }
    };
    return new Promise(function(resolve, reject) {
        request(reqOptions, function(error, response, body) {
            if (error || response.statusCode !== 200 || !body.responseData) {
                reject({
                    error: error || undefined,
                    status: response.status || undefined,
                    headers: response.headers || undefined
                });
                return;
            }
            resolve(body.responseData.results);
        });
    });
}

function getFastestImage(candidates) {
    var promises = [];
    candidates.forEach(function(candidate) {
        promises.push(fetchImage(candidate));
    });
    Promise.any(promises).then(function() {
        promises.forEach(function(promise) {
            if (promise.isPending()) {
                promise.cancel();
            }
        });
    }).catch(function(){});
    return Promise.any(promises);
}

function fetchImage(candidate) {
    var customHeaders = {
        'User-Agent': app.identifier
    };
    var reqOptions = {
        method: 'GET',
        uri: candidate.unescapedUrl,
        gzip: true,
        strictSSL: false,
        timeout: config.requestTimeout * 1000,
        headers: customHeaders,
        encoding: null
    };
    var bytesDownloaded = 0;
    var imageRequest;

    return new Promise(function(resolve, reject) {
        imageRequest = request(reqOptions, function(error, response, body) {
            if (error) {
                reject({
                    error: error
                });
                return;
            }
            var headers = response.headers, status = response.statusCode;
            if (status !== 200) {
                reject({
                    status: status,
                    headers: headers
                });
                return;
            }
            var mime = headers['content-type'];
            var fileData = {
                value: body,
                options: {
                    contentType: mime
                }
            };
            var mimeSeparator = mime.indexOf(';');
            if (mimeSeparator !== -1) {
                mime = mime.substring(0, mimeSeparator);
            }
            if (mime.indexOf('image') !== 0 || /webp$/i.test(mime)) {
                reject({
                    mime: mime
                });
            }
            fileData.options.filename =
                mime.replace(/[\/\-]/g, '.').replace('bitmap', 'bmp');
            resolve({
                candidate: candidate,
                fileUpload: fileData
            });
        }).on('response', function(response) {
            var contentLength = response.headers['content-length'];
            if (contentLength !== undefined &&
                contentLength > config.maxImageSize) {
                this.abort();
                reject({
                    size: contentLength
                });
            }
        }).on('data', function(chunk) {
            bytesDownloaded += chunk.length;
            if (bytesDownloaded > config.maxImageSize) {
                this.abort();
                reject({
                    size: bytesDownloaded
                });
            }
        });
    }).cancellable().catch(Promise.CancellationError, function() {
        imageRequest.abort();
    });
}
