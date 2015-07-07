var extend = require('util-extend');
var fs = require('fs');
var path = require('path');
var irc = require('irc');
var Q = require('q');

var api, config, log, persist, storage;
var handlers = {};
var clients = [], inboundRoutes = [], outboundRoutes = [];

module.exports = function loadPlugin(resources, services) {
    log = resources.log;
    api = resources.api;
    config = resources.config;
    persist = services.persist;
    return handlers;
};

handlers.enable = function(cb) {
    persist.load().then(function(result) {
        storage = result;
        storage.telegramAliases = storage.telegramAliases || {};
        return Q.fcall(function() {
            Object.keys(config.servers).forEach(function(serverName) {
                var serverConfig = config.servers[serverName];
                var client = new irc.Client(
                    serverConfig.host, serverConfig.nick,
                    extend(serverConfig.options, {
                        stripColors: true,
                        channels: Object.keys(serverConfig.channels),
                        autoConnect: false
                    })
                );
                makeRoutes(client, serverName, serverConfig);
                setupClient(client, serverName, serverConfig);
                clients.push(client);
                client.connect(config.ircRetryCount);
            });
        });
    }).nodeify(cb);
};

handlers.disable = function(cb) {
    if (clients.length) {
        log.trace('Disconnecting from ' + clients.length + ' IRC servers');
    }
    clients.forEach(function(client) {
       client.disconnect(config.ircQuitReason);
    });
    inboundRoutes.length = 0;
    outboundRoutes.length = 0;
    clients.length = 0;
    process.nextTick(function() {
        cb(null, true);
    });
};

handlers.handleMessage = function(message, meta) {
    if (!meta.fresh || meta.private) {
        return;
    }
    if (meta.command) {
        var command = meta.command;
        switch (command.name) {
        case 'names':
            if (command.argumentTokens.length) {
                sendNamesRequest(message.chat.id, command.argumentTokens[0]);
            }
            return;
        case 'whois':
            if (command.argumentTokens.length) {
                sendWhoisRequest(
                    message.chat.id, command.argumentTokens[0],
                    command.argumentTokens.slice(1, 3).join(' ')
                );
            }
            return;
        case 'setalias':
            setAlias(message.chat.id, message.from.id,
                     command.argumentTokens[0]);
            return;
        case '#':
        case '/':
            return;
        }
    }
    relayTelegramEvent(message);
};

function makeRoutes(client, serverName, serverConfig) {
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
    });
    client.on('ctcp', function(from, to, text) {
        log.trace('Received CTCP ' + text + ' from IRC user ' + from +
                  '@' + serverName)
    });
    client.on('message#', function(nick, to, text) {
        relayIrcEvent({
            type: 'message', channel: to, from: nick, text: text
        }, client.nick);
    });
    client.on('notice', function(nick, to, text) {
        relayIrcEvent({
            type: 'notice', channel: to, from: nick, text: text
        }, client.nick);
    });
    client.on('action', function (from, to, text) {
        relayIrcEvent({
            type: 'action', channel: to, from: from, text: text
        }, client.nick);
    });
    client.on('join', function (channel, nick) {
        relayIrcEvent({
            type: 'join', channel: channel, user: nick
        }, client.nick);
    });
    client.on('part', function (channel, nick, reason) {
        relayIrcEvent({
            type: 'part', channel: channel, user: nick, reason: reason
        }, client.nick);
    });
    client.on('quit', function (nick, reason, channels) {
        relayIrcEvent({
            type: 'quit', channels: channels, user: nick, reason: reason
        }, client.nick);
    });
    client.on('kick', function (channel, nick, by, reason) {
        relayIrcEvent({
            type: 'kick', channel: channel, user: nick, reason: reason, by: by
        }, client.nick);
    });
    client.on('nick', function (oldnick, newnick, channels) {
        relayIrcEvent({
            type: 'nick', channels: channels, from: oldnick, to: newnick
        }, client.nick);
    });
    client.on('topic', function (channel, topic, nick) {
        relayIrcEvent({
            type: 'topic', channel: channel, topic: topic, user: nick
        }, client.nick);
    });
    client.on('names', function (channel, nicks) {
        relayIrcEvent({
            type: 'names', channel: channel, users: nicks
        }, client.nick);
    });
}

function relayIrcEvent(event, ownUser) {
    var channels;
    if (event.channel) {
        channels = [event.channel];
    } else if (event.channels) {
        channels = event.channels;
    } else {
        return;
    }
    inboundRoutes.forEach(function(route) {
        if (!isInChannel(route.from, channels)) {
            return;
        }
        var relayText = formatIrcEvent(event, ownUser);
        if (relayText) {
            api.sendMessage({
                chat_id: route.to,
                text: relayText
            });
        }
        // Easter egg, see config.json
        if (config.rheet && event.text && /rhe{2,}t/i.test(event.text)) {
            api.sendAudio({
                chat_id: route.to,
                audio: {
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
}

function relayTelegramEvent(event) {
    var group = event.chat.id;
    outboundRoutes.forEach(function(route) {
        if (group == route.from) {
            var relayText = formatTelegramEvent(event);
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

function formatIrcEvent(event, ownUser) {
    if (config.ircEvents.indexOf(event. type) === -1) {
        return;
    }

    if (event.reason) {
        event.reason = event.reason.replace('"', '');
    } else {
        event.reason = '';
    }
    var userSuffix = config.ircUserSuffix ? '@' + event.channel : '';

    switch (event.type) {
    case 'message':
    case 'notice':
        return '<' + event.from + userSuffix + '> ' + event.text;
    case 'action':
        return '** ' + event.from + userSuffix + ' ' + event.text;
    case 'join':
        if (event.user === ownUser) {
            return 'I am now attached to channel ' + event.channel;
        }
        return 'User ' + event.user + ' joined channel ' + event.channel;
    case 'part':
        if (event.user === ownUser) {
            return 'I am now detached from channel ' + event.channel;
        }
        return 'User ' + event.user + ' left channel ' + event.channel +
               ' (reason: "' + event.reason + '")';
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
                Object.keys(event.users).filter(function(user) {
                    return user !== ownUser;
                }).join(', ');
    default:
        log.debug('received ' + event.type);
    }
}

function formatTelegramEvent(message) {
    var lines = [];
    if (!message.text) {
        return lines;
    }
    var username = storage.telegramAliases[message.from.id] ||
                   message.from.username ||
                   message.from.first_name;
    message.text.replace("\r", '').split("\n").forEach(function(line) {
        lines.push('<' + irc.colors.wrap(colorForUser(username),
                   irc.colors.wrap('bold', username)) +
                   config.telegramUserSuffix + '> ' + line);
    });
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
                chat_id: telegramGroup,
                text: JSON.stringify(whois, null, config.whoisIndenting)
            });
        });
    }
}

function setAlias(telegramGroup, telegramUser, alias) {
    storage.telegramAliases[telegramUser] = alias;
    api.sendMessage({
        chat_id: telegramGroup,
        text: 'Alias set to "' + alias + '".'
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

function isInChannel(channel, channels) {
    return channels.some(function(element) {
        return element.toLowerCase() === channel.toLowerCase();
    });
}

function colorForUser(user) {
    if (!config.ircColoredNames) {
        return 'reset';
    }
    var hash = config.ircColorHashBase;
    for (var i = 0; i < user.length; i++) {
        hash += user.charCodeAt(i);
    }
    var colors = Object.keys(irc.colors.codes).filter(function(color) {
        return (color !== 'white' && color !== 'black' && color !== 'reset' &&
                color !== 'bold' && color !== 'underline');
    });
    return colors[hash % colors.length];
}
