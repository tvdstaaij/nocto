var _ = require('lodash');
var fs = require('fs');
var irc = require('irc');
var path = require('path');
var Promise = require('bluebird');

var api, config, log, persist, storage, emoji;
var handlers = {}, clients = {}, groupScopeMap = {}, channelScopeMap = {};
var inboundRoutes = [], outboundRoutes = [], copyRoutes = [], readyServers = [];

const YES = ['1', 'true', 'on'];
const NO = ['0', 'false', 'off'];

const PREFERENCES_KEY_RELAYABLE = 'relayable';
const PREFERENCES_KEY_COLOUR = 'colour';
const PREFERENCES_KEY_ALIAS = 'alias';

const TELEGRAM_USER_PREFERENCES_DEFAULT = {
    [PREFERENCES_KEY_RELAYABLE]: true,
    [PREFERENCES_KEY_COLOUR]: null,
    [PREFERENCES_KEY_ALIAS]: null
};

module.exports = function loadPlugin(resources, service) {
    log = resources.log;
    api = resources.api;
    config = resources.config;
    persist = service('persist');
    emoji = service('emoji');
    return handlers;
};

handlers.enable = function(cb) {
    persist.load().then(function(result) {
        storage = result;
        storage.telegramUserPreferences = storage.telegramUserPreferences || {};

        // Load legacy config
        object.keys(storage.telegramColors || {}).forEach(
            user => setUserPreference(user, PREFERENCES_KEY_COLOUR, storage.telegramColors[user]));
        storage.telegramColors = {};
        object.keys(storage.telegramAliases || {}).forEach(
            user => setUserPreference(user, PREFERENCES_KEY_ALIAS, storage.telegramAliases[user]));
        storage.telegramAliases = {};
        
        return Promise.try(function() {
            Object.keys(config.servers).forEach(function(serverName) {
                var serverConfig = config.servers[serverName];
                var client = new irc.Client(
                    serverConfig.host, serverConfig.nick,
                    _.extend(serverConfig.options, {
                        stripColors: true,
                        channels: Object.keys(serverConfig.channels),
                        autoConnect: false
                    })
                );
                setupClient(client, serverName, serverConfig);
                clients[serverName] = client;
                client.connect(config.ircRetryCount);
            });
            Object.keys(clients).forEach(function(serverName) {
                makeCopyRoutes(clients[serverName], serverName,
                               config.servers[serverName]);
            });
        });
    }).nodeify(cb);
};

handlers.disable = function(cb) {
    var serverNames = Object.keys(clients);
    if (serverNames.length) {
        log.trace('Disconnecting from ' + serverNames.length + ' IRC servers');
    }
    serverNames.forEach(function(serverName) {
       clients[serverName].disconnect(config.ircQuitReason);
    });
    inboundRoutes.length = 0;
    outboundRoutes.length = 0;
    copyRoutes.length = 0;
    clients = {};
    groupScopeMap = {};
    channelScopeMap = {};
    process.nextTick(function() {
        cb(null, true);
    });
};

handlers.handleMessage = function(message, meta) {
    if (!meta.fresh || meta.private) {
        return;
    }
    var text = message.text;
    // Don't relay "comment" messages starting with // or # or variants
    if (text && /^(#|\/\s|[#/]{2,})/.test(text)) {
        return;
    }

    var relayOptions = {
        decodeEmoji: config.ircDecodeEmoji
    };
    var command = meta.command;
    if (command) {
        var chatId = message.chat.id;
        switch (command.name) {
        case 'names':
            var channel = null;
            if (command.argumentTokens.length === 1) {
                channel = command.argumentTokens[0];
            } else if (command.argumentTokens.length === 0) {
                var matches = findChannelsForGroup(chatId);
                if (matches.length === 1) {
                    channel = _.head(matches);
                }
            }
            if (channel) {
                sendNamesRequest(chatId, channel);
            } else {
                api.sendMessage({
                    chat_id: chatId,
                    text: 'Wrong number of arguments.'
                });
            }
            return;
        case 'whois':
            var channel = null;
            if (command.argumentTokens.length === 2) {
                channel = command.argumentTokens.shift();
            } else if (command.argumentTokens.length === 1) {
                var matches = findChannelsForGroup(chatId);
                if (matches.length === 1) {
                    channel = _.head(matches);
                }
            }
            if (channel) {
                sendWhoisRequest(chatId, channel, command.argumentTokens[0]);
            } else {
                api.sendMessage({
                    chat_id: chatId,
                    text: 'Wrong number of arguments.'
                });
            }
            return;
        case 'setalias':
            setAlias(chatId, message.from.id, command.argumentTokens[0]);
            return;
        case 'setrelay':
            setUserRelayable(chatId, message.from.id, command.argumentTokens[0]);
            return;
        case 'setcolor':
            setColor(chatId, message.from.id, command.argumentTokens[0]);
            return;
        case 'c':
            if (config.telegramComments) {
                return;
            }
            break;
        case 'e':
        case 'emo':
        case 'emoji':
            relayOptions.decodeEmoji = false;
            message.text = command.argument;
            break;
        }
    }

    // Don't relay messages from users that have opted out
    if (!getUserPreference(message.from.id, PREFERENCES_KEY_RELAYABLE)) {
        return;
    }

    message.meta = meta;
    relayTelegramEvent(message, relayOptions);
};

function makeTelegramRoutes(client, serverName, serverConfig) {
    Object.keys(serverConfig.channels).forEach(function(channelName) {
        var bridgeConfig = serverConfig.channels[channelName];
        if (bridgeConfig && bridgeConfig.relayFrom) {
            bridgeConfig.relayFrom.forEach(function(groupId) {
                outboundRoutes.push({
                    serverName: serverName,
                    client: client,
                    from: groupId,
                    to: channelName
                });
            });
        }
        if (bridgeConfig && bridgeConfig.relayTo) {
            bridgeConfig.relayTo.forEach(function(groupId) {
                inboundRoutes.push({
                    serverName: serverName,
                    client: client,
                    from: channelName,
                    to: groupId
                });
                groupScopeMap[groupId] = groupScopeMap[groupId] || [];
                groupScopeMap[groupId].push(channelName.toLowerCase());
            });
        }
    });
}

function makeCopyRoutes(client, serverName, serverConfig) {
    Object.keys(serverConfig.channels).forEach(function(channelName) {
        var bridgeConfig = serverConfig.channels[channelName];
        if (bridgeConfig && bridgeConfig.copyTo) {
            bridgeConfig.copyTo.forEach(function (target) {
                var otherClient = clients[target.server];
                if (!otherClient) {
                    log.warn('Unknown server ' + target.server + ', skipping' +
                        ' copy route to ' + target.channel);
                    return;
                }
                copyRoutes.push({
                    from: {
                        client: client,
                        serverName: serverName,
                        channel: channelName
                    },
                    to: {
                        client: otherClient,
                        serverName: target.server,
                        channel: target.channel
                    }
                });
                var channelId = (target.server + target.channel).toLowerCase();
                channelScopeMap[channelId] = channelScopeMap[channelId] || [];
                channelScopeMap[channelId].push(
                    (serverName + channelName).toLowerCase()
                );
            });
        }
    });
}

function setupClient(client, serverName, serverConfig) {
    client.on('error', function(error) {
        log.debug('IRC server error from ' + serverName + ':', error);
    });
    client.on('netError', function(error) {
        log.error('IRC network error for server ' + serverName, error);
    });
    client.on('registered', function() {
        log.trace('Sucessfully connected to IRC server ' + serverName);
        serverConfig.autoPerform.forEach(function(command) {
            irc.Client.prototype.send.apply(client, command);
        });
        // If not a reconnect
        if (readyServers.indexOf(serverName) === -1) {
            readyServers.push(serverName);
            makeTelegramRoutes(client, serverName, serverConfig);
        }
    });
    client.on('message#', function(nick, to, text) {
        relayIrcEvent({
            type: 'message', channel: to, from: nick, text: text
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('notice', function(nick, to, text) {
        relayIrcEvent({
            type: 'notice', channel: to, from: nick, text: text
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('action', function (from, to, text) {
        relayIrcEvent({
            type: 'action', channel: to, from: from, text: text
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('join', function (channel, nick) {
        relayIrcEvent({
            type: 'join', channel: channel, user: nick
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('part', function (channel, nick, reason) {
        relayIrcEvent({
            type: 'part', channel: channel, user: nick, reason: reason
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('quit', function (nick, reason, channels) {
        relayIrcEvent({
            type: 'quit', channels: channels, user: nick, reason: reason
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('kick', function (channel, nick, by, reason) {
        relayIrcEvent({
            type: 'kick', channel: channel, user: nick, reason: reason, by: by
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('nick', function (oldnick, newnick, channels) {
        relayIrcEvent({
            type: 'nick', channels: channels, from: oldnick, to: newnick
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('topic', function (channel, topic, nick) {
        relayIrcEvent({
            type: 'topic', channel: channel, topic: topic, user: nick
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('names', function (channel, nicks) {
        relayIrcEvent({
            type: 'names', channel: channel, users: nicks
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('+mode', function (channel, by, mode, argument) {
        relayIrcEvent({
            type: 'mode', sign: '+', channel: channel, by: by, mode: mode,
            argument: argument
        }, {ownUser: client.nick, serverName: serverName});
    });
    client.on('-mode', function (channel, by, mode, argument) {
        relayIrcEvent({
            type: 'mode', sign: '-', channel: channel, by: by, mode: mode,
            argument: argument
        }, {ownUser: client.nick, serverName: serverName});
    });
}

function relayIrcEvent(event, context) {
    var channels;
    if (event.channel) {
        channels = [event.channel];
    } else if (event.channels) {
        channels = event.channels;
    } else {
        return;
    }

    var relayedToGroups = [];
    inboundRoutes.forEach(function(route) {
        var eventCopy = _.clone(event);
        // Ignore if not relevant to this route
        if (route.serverName !== context.serverName ||
            !isInChannel(route.from, channels)) {
            return;
        }
        // Don't leak multichannel events (nick/quit) leak outside group scope
        var groupScope = groupScopeMap[route.to];
        if (event.channels) {
            eventCopy.channels = event.channels.filter(function(channel) {
                return (groupScope && groupScope.length &&
                        groupScope.indexOf(channel.toLowerCase()) !== -1);
            });
        }
        if (event.channels && !eventCopy.channels) {
            return;
        }
        // Prevent multichannel events from being sent twice to the same group
        if (relayedToGroups.indexOf(route.to) !== -1) {
            return;
        }
        relayedToGroups.push(route.to);

        var output = formatIrcEvent(eventCopy, context.ownUser);
        if (output) {
            api.sendMessage({
                parse_mode: output.markdown ? 'Markdown' : undefined,
                chat_id: route.to,
                text: output.text
            })
                .catch(function(error) {
                    var description = _.get(error, 'response.description');
                    if (output.markdown &&
                        _.includes(description, 'parse message text')) {
                        output = formatIrcEvent(eventCopy, context.ownUser,
                            {forcePlain: true});
                        api.sendMessage({
                            chat_id: route.to,
                            text: output.text
                        });
                    } else {
                        throw error;
                    }
                });
        }
        // Easter egg, see config.json
        if (config.rheet && event.text && /rhe{2,}t/i.test(event.text)) {
            api.sendVoice({
                chat_id: route.to,
                voice: {
                    value: fs.createReadStream(
                        path.join(__dirname, config.rheet)
                    ),
                    options: {
                        filename: 'rheet.ogg',
                        contentType: 'audio/ogg'
                    }
                }
            }, {
                fileUpload: true
            });
        }
    });

    var relayedToChannels = [];
    copyRoutes.forEach(function(route) {
        var eventCopy = _.clone(event);
        // Ignore if target not ready yet
        if (readyServers.indexOf(route.to.serverName) === -1) {
            return;
        }
        // Ignore if not relevant to this route
        if (route.from.serverName !== context.serverName ||
            !isInChannel(route.from.channel, channels)) {
            return;
        }
        // Prevent multichannel events from being sent twice to the same channel
        var channelId = (route.to.serverName + route.to.channel).toLowerCase();
        if (relayedToChannels.indexOf(channelId) !== -1) {
            return;
        }
        relayedToChannels.push(channelId);
        // Don't leak multichannel events (nick/quit) leak outside channel scope
        var channelScope = channelScopeMap[channelId];
        if (event.channels) {
            eventCopy.channels = event.channels.filter(function(channel) {
                return (channelScope && channelScope.length &&
                        channelScope.indexOf(
                            (context.serverName + channel).toLowerCase()
                        ) !== -1);
            });
        }
        if (event.channels && !eventCopy.channels) {
            return;
        }

        var relayText = formatIrcEvent(eventCopy, context.ownUser, {
            ircToIrc: true
        });
        route.to.client.say(route.to.channel, relayText);
    });
}

function relayTelegramEvent(event, options) {
    var group = event.chat.id;
    outboundRoutes.forEach(function(route) {
        if (group === route.from) {
            var relayText = formatTelegramEvent(event, options);
            if (relayText) {
                relayText.slice(0, config.telegramLineLimit)
                    .forEach(function (line) {
                        route.client.say(route.to, line);
                    });
                var exceedCount = relayText.length - config.telegramLineLimit;
                if (exceedCount > 0) {
                    route.client.say(route.to, irc.colors.wrap('light_gray',
                        '[' + exceedCount + ' more line(s) omitted]'
                    ));
                }
            }
        }
    });
}

function formatIrcEvent(event, ownUser, options) {
    options = options || {};
    if (options.ircToIrc) {
        options.forcePlain = true;
    }
    if (config.ircEvents.indexOf(event.type) === -1) {
        return;
    }

    if (event.reason) {
        event.reason = event.reason.replace('"', '');
    } else {
        event.reason = '';
    }
    var useMarkdown = (config.allowMarkdown && !options.forcePlain &&
        _.includes(['message', 'notice', 'action'], event.type) &&
        !options.ircToIrc);
    if (!options.ircToIrc && event.text && config.ircEncodeEmoji) {
        event.text = emoji.namesToUnicode(event.text);
    }
    if (!options.ircToIrc && event.text && config.emojiSkinVariants) {
        event.text = emoji.applySkinVariants(event.text);
    }
    var userSuffix = config.ircUserSuffix ? '@' + event.channel : '';

    function escapeMd(text) {
        return useMarkdown ? api.escapeMarkdown(text) : text;
    }

    var output = (function() {
        switch (event.type) {
            case 'message':
            case 'notice':
                return escapeMd('<' + event.from + userSuffix + '> ') +
                    event.text;
            case 'action':
                return escapeMd('** ' + event.from + userSuffix + ' ') +
                    event.text;
            case 'join':
                if (event.user === ownUser) {
                    return 'I am now attached to channel ' + event.channel;
                }
                return 'User ' + event.user +
                    ' joined channel ' + event.channel;
            case 'part':
                if (event.user === ownUser) {
                    return 'I am now detached from channel ' + event.channel;
                }
                return 'User ' + event.user + ' left channel ' +
                    event.channel + ' (reason: "' + event.reason + '")';
            case 'quit':
                return 'User ' + event.user + ' disconnected (reason: "' +
                    event.reason + '") and is no longer in channel(s) ' +
                    event.channels.join(', ');
            case 'kick':
                var target = (event.user === ownUser) ? 'I' : 'User ' + event.user;
                return target + ' was kicked from channel ' + event.channel +
                    ' by ' + event.by + ' (reason: "' + event.reason + '")';
            case 'nick':
                if (event.user === ownUser) {
                    return;
                }
                return 'User ' + event.from + ' is now known as ' + event.to +
                    ' in channel(s) ' + event.channels.join(', ');
            case 'topic':
                return 'Topic for ' + event.channel + ' is "' + event.topic +
                    '" (set by ' + event.user + ')';
            case 'names':
                return 'Other users in channel ' + event.channel + ': ' +
                    Object.keys(event.users).filter(function (user) {
                        return user !== ownUser;
                    }).join(', ');
            case 'mode':
                var argument = event.argument ? ' ' + event.argument : '';
                return event.by + ' applied mode ' + event.sign + event.mode +
                    argument + ' to channel ' + event.channel;
            default:
                log.debug('Received unknown irc event ' + event.type);
        }
    })();
    if (output) {
        if (options.ircToIrc) {
            return output;
        }
        return {
            text: output,
            markdown: useMarkdown
        };
    }
}

function formatTelegramEvent(message, options) {
    options = options || {};
    var lines = [];
    var location = message.location;
    var contact = message.contact;
    var text = message.text;
    var username = getUserPreference(message.from.id, PREFERENCES_KEY_ALIAS,
        message.from.username || message.from.first_name);
    if (location) {
        lines.push(username +
                   ' sent location: http://maps.google.com/maps?t=m&q=loc:' +
                   location.latitude + ',' + location.longitude);
    } else if (contact) {
        var name = contact.first_name + (contact.last_name ?
                   ' ' + contact.last_name : '');
        var number = '+' + contact.phone_number;
        lines.push(username + ' sent contact: ' + name + ', ' + number);
    } else if (text) {
        if (options.decodeEmoji) {
            text = emoji.unicodeToNames(text);
        } else if (config.emojiSkinVariants) {
            text = emoji.applySkinVariants(text);
        }
        text.replace("\r", '').split("\n").forEach(function (line) {
            if (config.ircBoldNames) {
                username = irc.colors.wrap('bold', username);
            }
            if (config.ircColoredNames) {
                const color = getUserPreference(message.from.id, PREFERENCES_KEY_COLOUR);
                if (color) {
                    username = irc.colors.wrap(color, username);
                }
            }
            lines.push('<' + username + config.telegramUserSuffix +
                '> ' + line);
        });
    } else if (message.meta.permalink) {
        lines.push(username + config.telegramUserSuffix +
            ' sent ' + message.meta.permalink);
    }
    return lines;
}

function sendNamesRequest(telegramGroup, ircChannel) {
    var client = findClientForChannel(ircChannel, telegramGroup);
    if (client) {
        client.send('NAMES', ircChannel);
    }
}

function sendWhoisRequest(telegramGroup, ircChannel, ircUser) {
    var client = findClientForChannel(ircChannel, telegramGroup);
    if (client) {
        client.whois(ircUser, function(whois) {
            api.sendMessage({
                parse_mode: 'Markdown',
                chat_id: telegramGroup,
                text: wrapCodeBlock(
                    JSON.stringify(whois, null, config.whoisIndenting)
                )
            });
        });
    }
}

function setAlias(telegramGroup, telegramUser, alias) {
    // Validation: http://stackoverflow.com/a/5163309/1239690
    if (alias.length > 30 ||
        !/^[a-z_\-\[\]\\^{}|`][a-z0-9_\-\[\]\\^{}|`]*$/i.test(alias)) {
        api.sendMessage({
            chat_id: telegramGroup,
            text: 'Not a valid IRC nickname.'
        });
        return;
    }
    setUserPreference(telegramUser, PREFERENCES_KEY_ALIAS, alias);
    api.sendMessage({
        chat_id: telegramGroup,
        text: 'Alias set to "' + alias + '".'
    });
}

function setUserRelayable(telegramGroup, telegramUser, relayable) {
    const channels = findChannelsForGroup(telegramGroup);
    
    if (!relayable) {
        const messagesBeingRelayed = getUserPreference(telegramUser, PREFERENCES_KEY_RELAYABLE);
        const message = messagesBeingRelayed ?
            `Your messages are currently being relayed to ${channels.join(', ')}.` :
            'Your messages are currently NOT being relayed.';
        return api.sendMessage({
            chat_id: telegramGroup,
            text: message
        });
    } else if (YES.includes(relayable.toLowerCase())) {
        setUserPreference(telegramUser, PREFERENCES_KEY_RELAYABLE, true);
        return api.sendMessage({
            chat_id: telegramGroup,
            text: `Your messages will be relayed to ${channels.join(', ')}.`
        });
    } else if (NO.includes(relayable.toLowerCase())) {
        setUserPreference(telegramUser, PREFERENCES_KEY_RELAYABLE, false);
        return api.sendMessage({
            chat_id: telegramGroup,
            text: 'Your messages will NOT be relayed.'
        });
    }
    
    return api.sendMessage({
        chat_id: telegramGroup,
        text: 'Invalid value. Yes or no?'
    });
}

function setColor(telegramGroup, telegramUser, color) {
    color = color ? color.toLowerCase() : '';
    var colors = Object.keys(irc.colors.codes).filter(function(color) {
        return (color !== 'bold' && color !== 'underline');
    });
    if (colors.indexOf(color) === -1) {
        api.sendMessage({
            chat_id: telegramGroup,
            text: 'Available colors: ' + colors.sort().join(', ')
        });
        return;
    }
    setUserPreference(telegramUser, PREFERENCES_KEY_COLOUR, color);
    api.sendMessage({
        chat_id: telegramGroup,
        text: 'Nickname color set to "' + color + '".'
    });
}

function findClientForChannel(channel, telegramGroup) {
    var client = false;
    var channelFound = inboundRoutes.some(function(route) {
        if (isInChannel(channel, [route.from]) &&
            telegramGroup === route.to) {
            client = route.client;
            return true;
        }
        return false;
    });
    if (!channelFound) {
        api.sendMessage({
            chat_id: telegramGroup,
            text: 'Channel ' + channel +
            ' is not associated with this group.'
        });
    }
    return client;
}

function findChannelsForGroup(telegramGroup) {
    return _.map(_.filter(inboundRoutes, 'to', telegramGroup), 'from');
}

function isInChannel(channel, channels) {
    return channels.some(function(element) {
        return element.toLowerCase() === channel.toLowerCase();
    });
}

function wrapCodeBlock(text) {
    return '```\n' + text + '\n```';
}

function getUserPreference(user, key, fallback = null) {
    return _.get(storage.telegramUserPreferences, [user, key],
        fallback || TELEGRAM_USER_PREFERENCES_DEFAULT[key]);
}

function setUserPreference(user, key, value) {
    return _.set(storage.telegramUserPreferences, [user, key], value);
}
