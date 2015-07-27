var _ = require('lodash');
var Promise = require('bluebird');
var pleer = Promise.promisifyAll(require('pleer'));
var request = require('request');

var api, app, config, log, interact, searchSession, playSession;
var handlers = {};

module.exports = function loadPlugin(resources, service) {
    api = resources.api;
    app = resources.app;
    log = resources.log;
    config = resources.config;
    interact = service('interact');
    searchSession = interact.session();
    playSession = interact.session(0);
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    if (!meta.fresh) {
        return;
    }
    var command = meta.command;
    var addressed = Boolean(command && command.name === 'jukebox');
    var argumentTokens = command ? command.argumentTokens : null;
    var operation = argumentTokens && argumentTokens[0] ?
        argumentTokens[0].toLowerCase() : '';
    var argument = argumentTokens && argumentTokens[1] ?
        argumentTokens.slice(1).join(' ') : '';

    var thisSearchSession = searchSession(message.from.id);
    var thisPlaySession = playSession(message.chat.id);
    var reply = new api.MessageBuilder(message.chat.id)
        .replyIfKeyboard(message.message_id);
    var trackPromise = null;

    if (command) {
        thisSearchSession.data.invocation = command;
    }
    if (command && thisSearchSession.state() === 'result') {
        var trackNumber = parseInt(command.name);
        var result = thisSearchSession.data;
        if (_.isNumber(trackNumber) &&
            trackNumber >= 1 && trackNumber <= result.trackCount) {
            var track = result.tracks[trackNumber - 1];
            if (track) {
                trackPromise = Promise.resolve(track.track_id);
            }
            thisSearchSession.touch();
        }
    }
    if (addressed && operation === '') {
        api.sendMessage(reply.text(
            'What music track are you looking for?'
        ).build());
        thisSearchSession.state('search');
        return;
    } else if (!addressed && thisSearchSession.state() === 'search') {
        addressed = true;
        operation = 'search';
        argument = message.text;
    }
    if (addressed && operation === 'search' && argument) {
        api.sendChatAction(
            new api.MessageBuilder(message.chat.id).action('typing').build()
        );
        searchTrack(argument).then(function(result) {
            var maxSize = config.searchResultKeyboardSize;
            var i = 0;
            var tracks = result.tracks.slice(0, maxSize).map(function(track) {
                var bitrate = _.isNaN(parseInt(track.bitrate)) ?
                    track.bitrate : track.bitrate.toString() + 'kbps';
                    return '/' + ++i + ' ' + track.artist + ' - ' +
                           track.track + ' (' + bitrate + ')';
            });
            var keyboard =
                new api.KeyboardBuilder(_.range(1, tracks.length + 1))
                .columns(3).once(true).resize(true).selective(true)
                .prefix(thisSearchSession.data.invocation.prefix);
            api.sendMessage(
                reply.text(tracks.join("\n")).keyboard(keyboard.build()).build()
            );
            thisSearchSession.state('result');
            thisSearchSession.data.tracks = result.tracks;
            thisSearchSession.data.trackCount = tracks.length;
        }).catch(function(error) {
            api.sendMessage(reply.text(describeSearchFailure(error)).build());
            thisSearchSession.reset();
        });
        return;
    }
    if (addressed && operation === 'play' && argument) {
        trackPromise = searchTrack(argument).then(function(result) {
            return result.tracks[0].track_id;
        });
    }
    if (trackPromise) {
        if (thisPlaySession.state() === 'download') {
            api.sendMessage(reply.text(
                'An upload is already in progress, try again when it\'s done'
            ).build());
            return;
        }
        var persistentAction = api.sendPersistentChatAction(
            new api.MessageBuilder(message.chat.id)
            .action('upload_audio').build()
        );
        trackPromise.then(function(track) {
            return postTrack(track, reply).then(function() {
                thisPlaySession.state('success');
            }).catch(function(error) {
                var text = error.tgError ?
                'Failed to upload audio to Telegram' :
                'Failed to download audio file';
                api.sendMessage(reply.text(text).build());
                thisPlaySession.state('failure');
            });
        }).catch(function(error) {
            api.sendMessage(reply.text(describeSearchFailure(error)).build());
            thisPlaySession.state('failure');
        }).finally(function() {
            persistentAction.cancel();
        });
        thisPlaySession.state('download');
    }
};

function searchTrack(query) {
    return pleer.searchAsync(query, {
        quality: config.quality || 'all',
        limit: 20
    }).then(function(result) {
        if (!result || !(result.sucess === true || result.success === true) ||
            !result.tracks || !result.tracks.length) {
            throw result;
        }
        return result;
    });
}

function getTrackUrl(trackId) {
    return pleer.getUrlAsync(trackId, {'reason': 'listen'})
    .then(function(result) {
        if (!result || result.success !== true || !result.url) {
            throw result;
        }
        return result.url;
    });
}

function transportAudioFile(url, message) {
    var customHeaders = {
        'User-Agent': app.identifier
    };
    var reqOptions = {
        method: 'GET',
        url: url,
        headers: customHeaders,
        encoding: null,
        timeout: config.downloadTimeout * 1000
    };

    return new Promise(function(resolve, reject) {
        request(reqOptions).on('error', function(error) {
            reject({httpError: error});
        }).on('response', function(response) {
            var headers = response.headers, status = response.statusCode;
            if (status !== 200) {
                reject({
                    httpStatus: status,
                    httpHeaders: headers
                });
                return;
            }
            var contentDisposition = headers['content-disposition'];
            var filenameRegex = /filename="(.*?)(\[[^\]]+\])?(\.mp3)"/i;
            var filenameMatch = contentDisposition ?
                filenameRegex.exec(contentDisposition) : null;
            var fileData;
            if (contentDisposition && filenameMatch !== null) {
                fileData = {
                    value: response,
                    options: {
                        contentType: 'audio/mpeg',
                        filename: filenameMatch[1].trim() + filenameMatch[3]
                    }
                };
            } else {
                fileData = response;
            }
            message = message.document(fileData);
            api.sendDocument(
                message.build(), {fileUpload: true}
            ).then(function() {
                resolve();
            }).catch(function(error) {
                reject({tgError: error});
            });
        });
    });
}

function describeSearchFailure(error) {
    if (error.count && String(error.count) === '0') {
        return 'No search results';
    }
    return 'Search query failed';
}

function postTrack(trackId, message) {
    return getTrackUrl(trackId).then(function(url) {
        return transportAudioFile(url, message);
    });
}
