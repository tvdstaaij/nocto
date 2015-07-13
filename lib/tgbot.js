var util = require('util');
var EventEmitter = require('events').EventEmitter;
var request = require('request');
var log4js = require('log4js');
var Q = require('q');
var fs = require('fs');
var extend = require('util-extend');
var botUtil = require('./utilities.js');

function TgBot(options) {

    /* Properties and initialization */
    var self = this;
    var token = options.token;
    var pollTimeout = options.pollTimeout || 1;
    var callTimeout = options.callTimeout || 0;
    var pollRetry = options.pollRetry || 0;
    var baseUri = options.baseUri || 'https://api.telegram.org/bot';
    var offset = options.offset || 0;
    var strictSSL = options.strictSSL || true;
    var commandPrefix = util.isArray(options.commandPrefix) ?
                        options.commandPrefix : ['/'];
    var identity = null;
    var currentPollRequest = null;
    var pollActive = false;
    var pollStartDate = null;
    var log = log4js.getLogger(options.logCategory || this.constructor.name);
    if (!options.logCategory) {
        log.setLevel('OFF');
    }
    
    /* Privileged functions for poll control */
    this.poll = {
        getOffset: function() { return offset; },
        start: function() {
            pollStartDate = new Date();
            pollActive = true;
            pollApi();
        },
        stop: function() {
            pollActive = false;
            if (currentPollRequest) {
                log.info('A long poll is currently in progress, aborting');
                currentPollRequest.abort();
            }
        }
    };
 
    /* Privileged functions for executing API calls */
    this.api = {
        getMe: function(parameters, options, cb) {
            if (options && options.cache !== false && identity) {
                return Q.fcall(function() {
                    return identity;
                });
            }
            return callApi('getMe').then(function(result) {
                identity = {
                    id: result.id,
                    first_name: result.first_name,
                    username: result.username
                };
                self.emit('identityChanged', identity);
                return identity;
            }).nodeify(cb);
        },
        sendMessage: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'text', 'disable_web_page_preview',
                'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            return callApi('sendMessage', callParameters).nodeify(cb);
        },
        forwardMessage: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'from_chat_id', 'message_id'
            ]);
            return callApi('forwardMessage', callParameters).nodeify(cb);
        },
        sendPhoto: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'caption', 'photo', 'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            var callOptions = botUtil.addToObject({}, options, ['fileUpload']);
            return callApi('sendPhoto', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendAudio: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'audio', 'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            var callOptions = botUtil.addToObject({}, options, ['fileUpload']);
            return callApi('sendAudio', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendDocument: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'document', 'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            var callOptions = botUtil.addToObject({}, options, ['fileUpload']);
            return callApi('sendDocument', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendSticker: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'sticker', 'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            var callOptions = botUtil.addToObject({}, options, ['fileUpload']);
            return callApi('sendSticker', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendVideo: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'video', 'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            var callOptions = botUtil.addToObject({}, options, ['fileUpload']);
            return callApi('sendVideo', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendLocation: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'latitude', 'longitude', 'reply_to_message_id'
            ]);
            addReplyMarkup(callParameters, parameters);
            return callApi('sendLocation', callParameters).nodeify(cb);
        },
        sendChatAction: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'chat_id', 'action'
            ]);
            return callApi('sendChatAction', callParameters).nodeify(cb);
        },
        getUserProfilePhotos: function(parameters, options, cb) {
            var callParameters = botUtil.addToObject({}, parameters, [
                'user_id', 'offset', 'limit'
            ]);
            return callApi('getUserProfilePhotos', callParameters, callOptions)
                   .nodeify(cb);
        }
    };
    
    /* Private functions */
    function addReplyMarkup(source, dest) {
        if (dest && source && source.reply_markup) {
            dest.reply_markup = JSON.stringify(source.reply_markup);
        }
    }
    
    function callApi(method, parameters, options) {
        options = options || {};
        var deferred = Q.defer();
        var reqOptions = {
            uri: baseUri + token + '/' + method,
            method: parameters ? 'POST' : 'GET',
            json: true,
            gzip: true,
            timeout: (!options.ignoreTimeout && callTimeout) ?
                     callTimeout : undefined,
            strictSSL: strictSSL,
        };
        if (parameters) {
            reqOptions[options.fileUpload ? 'formData' : 'form'] = parameters;
        }
        var callTrace = {
            apiMethod: method,
            reqMethod: reqOptions.method,
            uri: reqOptions.url,
            parameters: parameters
        };
        var reqCallback = function(error, response, body) {
            if (error || response.statusCode != 200 || !body.ok || !body.result) {
                var errorData = {
                    httpError: error,
                    httpStatus: response ? response.statusCode : null,
                    response: body,
                    callTrace: callTrace
                };
                deferred.reject(new TgBot.ApiCallError(method, errorData));
                self.emit('apiCallFailed', errorData);
                log.error('API call ' + method + ' failed:', {
                    parameters: parameters,
                    httpError: errorData.httpError,
                    httpStatus: errorData.httpStatus,
                    response: errorData.response
                });
            } else {
                deferred.resolve(body.result);
            }
        };
        
        var pendingRequest = request(reqOptions, reqCallback);
        if (options.saveRequest) {
            options.saveRequest(pendingRequest);
        }
        return deferred.promise;
    }
    
    function pollApi() {
        log.trace('Starting long poll cycle with offset ' + offset);
        if (currentPollRequest) {
            errorMsg = 'Attempt to poll API while another poll is already in progress';
            log.warn(errorMsg);
            throw new TgBot.PollingError(errorMsg);
        }
        callApi('getUpdates', {
            offset: offset || undefined,
            timeout: pollTimeout || undefined
        }, {
            ignoreTimeout: true,
            saveRequest: function(r) { currentPollRequest = r; }
        })
        .then(function(result) {
            var date = new Date();
            log.trace('Poll cycle complete, got ' + result.length + ' updates');
            var oldOffset = offset;
            result.forEach(function(update) {
                if (update.update_id >= offset) {
                    offset = update.update_id + 1;
                }
                handleUpdate(update, date);
            });
            self.emit('pollSucceeded', result.length);
            if (oldOffset != offset) {
                self.emit('offsetChanged', offset);
            }
            if (pollActive) {
                process.nextTick(pollApi);
            }
        }, function(error) {
            log.debug('Poll failed: ', error);
            if (pollRetry && pollActive) {
                setTimeout(pollApi, pollRetry);
                self.emit('pollRetryScheduled', error, pollRetry);
             } else {
                self.emit('pollAborted', error);
             }
        }).finally(function() {
            currentPollRequest = null;
        }).done();
    }
    
    function handleUpdate(update, date) {
        var updateData = {
            receiveDate: date
        };
        if (update.message) {
            var message = update.message;
            var sendDate = botUtil.makeNativeDate(message.date);
            self.emit('messageReceived', message, extend(updateData, {
                private: Boolean(message.chat && message.chat.first_name),
                command: parseCommand(message.text),
                sendDate: sendDate,
                fresh: Boolean(pollStartDate && sendDate > pollStartDate),
                forwardDate: message.forward_date ?
                             botUtil.makeNativeDate(message.forward_date) : 
                             undefined
            }));
        } else {
            // Message is specified as an optional field in the api, but there
            // aren't any alternatives yet.
            log.debug('Got update that doesn\'t contain a message?', update);
        }
    }
    
    function parseCommand(message) {
        if (!message) {
            return;
        }
        var nameOffset = -1;
        commandPrefix.some(function(prefix) {
            if (message.indexOf(prefix) === 0) {
                nameOffset = prefix.length;
                return true;
            }
            return false;
        });
        if (nameOffset === -1) {
            return null;
        }

        var argument = null, target = null;
        var argumentTokens = [];

        var firstSpace = /\s/.exec(message);
        firstSpace = firstSpace ? firstSpace.index : undefined;
        if (firstSpace) {
            argument = message.substr(firstSpace + 1);
            argumentTokens = argument.split(/\s/);
        }

        var name = message.substring(nameOffset, firstSpace);

        var targetOffset = name.lastIndexOf('@');
        if (targetOffset !== -1) {
            target = name.substr(targetOffset + 1);
            name = name.substring(0, targetOffset);
        }

        return {
            name: name,
            target: target,
            argument: argument,
            argumentTokens: argumentTokens
        };
    }
}
util.inherits(TgBot, EventEmitter);

TgBot.ApiCallError = function(method, data) {
    this.message = 'API call <<' + method + '>> failed';
    extend(this, data);
}
util.inherits(TgBot.ApiCallError, Error);

TgBot.PollingError = function(message) { this.message = message; }
util.inherits(TgBot.PollingError, Error);

module.exports = TgBot;
