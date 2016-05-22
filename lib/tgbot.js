var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var https = require('https');
var log4js = require('log4js');
var Promise = require('bluebird');
var request = require('request');
var util = require('util');
var botUtil = require('./utilities.js');
var apiHelpers = require('./tghelpers.js');

function TgBot(options) {

    /* Properties and initialization */
    var self = this;
    var token = options.token;
    var pollTimeout = options.pollTimeout || 1;
    var callTimeout = options.callTimeout || 0;
    var pollRetry = options.pollRetry || 0;
    var baseUri = options.baseUri || 'https://api.telegram.org';
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

    var agent = new https.Agent({
        keepAlive: true,
        maxSockets: options.maxSimultaneousConnections
    });
    this.agent = agent;

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

    /* Privileged functions for executing API calls and related utilities */
    this.api = {
        getIdentity: function() {
            return identity;
        },
        getMe: function(parameters, options, cb) {
            if ((!options || options.cache !== false) && identity) {
                return Promise.resolve(identity);
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
            var callParameters = _.pick(parameters, [
                'chat_id', 'text', 'disable_web_page_preview',
                'reply_to_message_id', 'parse_mode'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            return callApi('sendMessage', callParameters).nodeify(cb);
        },
        forwardMessage: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'from_chat_id', 'message_id'
            ]);
            return callApi('forwardMessage', callParameters).nodeify(cb);
        },
        sendPhoto: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'caption', 'photo', 'reply_to_message_id'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            var callOptions = _.pick(options, 'fileUpload');
            return callApi('sendPhoto', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendAudio: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'audio', 'reply_to_message_id'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            var callOptions = _.pick(options, 'fileUpload');
            return callApi('sendAudio', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendDocument: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'document', 'reply_to_message_id'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            var callOptions = _.pick(options, 'fileUpload');
            return callApi('sendDocument', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendSticker: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'sticker', 'reply_to_message_id'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            var callOptions = _.pick(options, 'fileUpload');
            return callApi('sendSticker', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendVideo: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'video', 'reply_to_message_id'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            var callOptions = _.pick(options, 'fileUpload');
            return callApi('sendVideo', callParameters, callOptions)
                   .nodeify(cb);
        },
        sendLocation: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'latitude', 'longitude', 'reply_to_message_id'
            ]);
            addSerializedProperty('reply_markup', callParameters, parameters);
            return callApi('sendLocation', callParameters).nodeify(cb);
        },
        sendChatAction: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'chat_id', 'action'
            ]);
            return callApi('sendChatAction', callParameters).nodeify(cb);
        },
        answerInlineQuery: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'inline_query_id', 'cache_time', 'is_personal', 'next_offset'
            ]);
            addSerializedProperty('results', callParameters, parameters);
            return callApi('answerInlineQuery', callParameters).nodeify(cb);
        },
        getUserProfilePhotos: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, [
                'user_id', 'offset', 'limit'
            ]);
            return callApi('getUserProfilePhotos', callParameters).nodeify(cb);
        },
        getFile: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, 'file_id');
            return callApi('getFile', callParameters).nodeify(cb);
        },
        getChat: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, 'chat_id');
            return callApi('getChat', callParameters).nodeify(cb);
        },
        leaveChat: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, 'chat_id');
            return callApi('leaveChat', callParameters).nodeify(cb);
        },
        getChatAdministrators: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, 'chat_id');
            return callApi('getChatAdministrators', callParameters).nodeify(cb);
        },
        getChatMembersCount: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, 'chat_id');
            return callApi('getChatMembersCount', callParameters).nodeify(cb);
        },
        getChatMember: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, ['chat_id', 'user_id']);
            return callApi('getChatMember', callParameters).nodeify(cb);
        },
        kickChatMember: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, ['chat_id', 'user_id']);
            return callApi('kickChatMember', callParameters).nodeify(cb);
        },
        unbanChatMember: function(parameters, options, cb) {
            var callParameters = _.pick(parameters, ['chat_id', 'user_id']);
            return callApi('unbanChatMember', callParameters).nodeify(cb);
        },
        getFileUri: function(fileInfo) {
            return baseUri + '/file/bot' + token + '/' +
                _.get(fileInfo, 'file_path');
        }
    };
    _.extend(this.api, apiHelpers(this.api));
    this.api.requestFile = function(fileInfo) {
        return request.defaults({
            uri: self.api.getFileUri(fileInfo),
            encoding: null,
            agent: agent
        });
    };

    /* Private functions */
    function addSerializedProperty(property, dest, source) {
        if (dest && source && source[property]) {
            dest[property] = JSON.stringify(source[property]);
        }
    }

    function callApi(method, parameters, options) {
        options = options || {};
        return new Promise(function(resolve, reject) {
            var reqOptions = {
                uri: baseUri + '/bot' + token + '/' + method,
                method: parameters ? 'POST' : 'GET',
                json: true,
                gzip: true,
                timeout: !options.fileUpload && !options.ignoreTimeout &&
                         callTimeout ? callTimeout : undefined,
                strictSSL: strictSSL,
                agent: agent
            };
            if (parameters) {
                var formType = options.fileUpload ? 'formData' : 'form';
                reqOptions[formType] = parameters;
            }
            var callTrace = {
                apiMethod: method,
                reqMethod: reqOptions.method,
                uri: reqOptions.uri,
                parameters: parameters
            };
            var reqCallback = function(error, response, body) {
                if (error || response.statusCode !== 200 ||
                    !body.ok || !body.result) {
                    var errorData = {
                        httpError: error,
                        httpStatus: response ? response.statusCode : null,
                        response: body,
                        callTrace: callTrace
                    };
                    reject(new TgBot.ApiCallError(method, errorData));
                    self.emit('apiCallFailed', errorData);
                } else {
                    resolve(body.result);
                }
            };

            var pendingRequest = request(reqOptions, reqCallback);
            if (options.fileUpload && pendingRequest._form) {
                pendingRequest._form.maxDataSize = 50 * 1024 * 1024;
            }
            if (options.saveRequest) {
                options.saveRequest(pendingRequest);
            }
        });
    }
    
    function pollApi() {
        log.trace('Starting long poll cycle with offset ' + offset);
        if (currentPollRequest) {
            var errorMsg = 'Attempt to poll API while another poll is already' +
                           ' in progress';
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
            self.emit('pollSucceeded', result.length);
            result.forEach(function(update) {
                if (update.update_id >= offset) {
                    offset = update.update_id + 1;
                }
                handleUpdate(update, date);
            });
            if (oldOffset !== offset) {
                self.emit('offsetChanged', offset);
            }
            if (pollActive) {
                process.nextTick(pollApi);
            }
        }).catch(function(error) {
            log.error('Poll failed: ', error);
            if (pollRetry && pollActive) {
                setTimeout(pollApi, pollRetry);
                self.emit('pollRetryScheduled', error, pollRetry);
             } else {
                self.emit('pollAborted', error);
             }
        }).finally(function() {
            currentPollRequest = null;
        });
    }
    
    function handleUpdate(update, date) {
        var updateData = {
            receiveDate: date
        };
        if (_.has(update, 'message')) {
            var message = update.message;
            var sendDate = botUtil.makeNativeDate(message.date);
            self.emit('messageReceived', message, _.extend(updateData, {
                private: Boolean(message.chat.id >= 0),
                command: parseCommand(message.text),
                sendDate: sendDate,
                fresh: Boolean(pollStartDate && sendDate > pollStartDate),
                forwardDate: message.forward_date ?
                             botUtil.makeNativeDate(message.forward_date) : 
                             undefined
            }));
        } else if (_.has(update, 'inline_query')) {
            self.emit('inlineQueryReceived', update.inline_query, updateData);
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
        var nameOffset = -1, namePrefix = null;
        commandPrefix.some(function(prefix) {
            if (message.indexOf(prefix) === 0) {
                nameOffset = prefix.length;
                namePrefix = message.substring(0, nameOffset);
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
            prefix: namePrefix,
            target: target,
            argument: argument,
            argumentTokens: argumentTokens
        };
    }
}
util.inherits(TgBot, EventEmitter);

TgBot.ApiCallError = function(method, data) {
    this.message = 'API call <<' + method + '>> failed';
    _.extend(this, data);
};
util.inherits(TgBot.ApiCallError, Error);

TgBot.PollingError = function(message) { this.message = message; };
util.inherits(TgBot.PollingError, Error);

module.exports = TgBot;
