var _ = require('lodash');
var urlRegex = require('url-regex');
var Announcer = require('./announcer.js');
var feedUtil = require('./utilities.js');

var announcer, api, config, log, persist, storage, session;
var handlers = {}, feeds = {};

module.exports = function loadPlugin(resources, service) {
    announcer = new Announcer(resources);
    log = resources.log;
    api = resources.api;
    config = resources.config;
    persist = service('persist');
    return handlers;
};

handlers.enable = function(cb) {
    persist.load().then(function(container) {
        storage = container;
        storage.feeds = storage.feeds || {};
        feeds = storage.feeds;
        announcer.schedule(feeds);
    }).nodeify(cb);
};

handlers.disable = function(cb) {
    process.nextTick(function() {
        announcer.schedule(false);
        cb(null, true);
    });
};

handlers.handleMessage = function(message, meta) {
    var command = meta.command;
    if (!meta.fresh || !command) {
        return;
    }
    var reply = null;
    if (/^(add|new)feed$/i.test(command.name)) {
        reply = checkPrivilege(meta.authority, config.privileges.manage) ||
                handleAddFeedCommand(message, meta);
    } else if (/^(re?m|remove|del(ete)?)feed$/i.test(command.name)) {
        reply = checkPrivilege(meta.authority, config.privileges.manage) ||
                handleDelFeedCommand(message, meta);
    } else if (/^sub(scribe)?$/i.test(command.name)) {
        reply = handleSubscribeCommand(message, meta);
    } else if (/^unsub(scribe)?$/i.test(command.name)) {
        reply = handleUnsubscribeCommand(message, meta);
    }
    if (reply) {
        var replyBase = {chat_id: message.chat.id};
        if (meta.private === false) {
            replyBase.reply_to_message_id = message.message_id;
        }
        api.sendMessage(_.extend(replyBase, reply));
    }
};

function checkPrivilege(authority, requirement) {
    if (!authority || !authority.isAtLeast(requirement)) {
        return {
            text: 'Sorry, you are not authorized to perform this operation.'
        };
    }
    return null;
}

function handleAddFeedCommand(message, meta) {
    if (!meta.command.argument) {
        return {text: 'Usage: /' + meta.command.name + ' <label> <url>'};
    }
    var input = meta.command.argument.trim();
    var argument = extractLabelUrlPair(input);
    if (!argument.url || !argument.label) {
        return {text: 'Please specifiy a valid feed label and URL.'};
    }
    if (feeds[argument.label]) {
        return {text: 'A feed with this label already exists.'};
    }
    feeds[argument.label] = {
        url: argument.url,
        owner: null,
        enabled: true,
        subscriptions: {}
    };
    announcer.schedule(feeds);
    return {text: 'Feed "' + argument.label + '" registered.'};
}

function handleDelFeedCommand(message, meta) {
    var label = meta.command.argument;
    if (!label) {
        var choices = listFeedCommandChoices(meta.command.name,
            feedUtil.isPublicFeed);
        if (!choices.length) {
            return {text: 'There are no shared feeds to remove.'};
        }
        return {
            text: 'Which feed would you like to remove?',
            reply_markup: makeFeedCommandKeyboard(choices)
        };
    }
    label = label.trim();
    var feed = feeds[label];
    if (!feed) {
        return {text: 'There is no feed labeled "' + label + '".'};
    }
    delete feeds[label];
    announcer.schedule(feeds);
    return {text: 'Feed "' + label + '" removed.'};
}

function handleSubscribeCommand(message, meta) {
    var input = _.trim(meta.command.argument);
    var subscriberId = message.chat.id;
    if (!input) {
        var choices = listFeedCommandChoices(meta.command.name, function(feed) {
            return feedUtil.isPublicFeed(feed) &&
                   !feedUtil.isSubscribed(subscriberId, feed);
        });
        if (!choices.length) {
            return {
                text: 'There are no more shared feeds you can subscribe to.'
            };
        }
        var groupNotice = meta.private ? '' : ' this group';
        return {
            text: 'Which feed do you wish to subscribe' + groupNotice + ' to?',
            reply_markup: makeFeedCommandKeyboard(choices)
        };
    }
    var argument = extractLabelUrlPair(input), label;
    if (argument.url) {
        return {text: 'Custom subcriptions are not supported yet.'};
    } else {
        label = input;
    }
    label = label.trim();
    var feed = feeds[label];
    if (!feed) {
        return {text: 'There is no feed labeled "' + label + '".'};
    }
    if (feed.owner !== null) {
        return {text: 'You can only subscribe to shared feeds.'};
    }
    var subscriptions = feed.subscriptions;
    subscriptions[subscriberId] = subscriptions[subscriberId] || {};
    return {text: 'Subscribed to feed "' + label + '".'};
}

function handleUnsubscribeCommand(message, meta) {
    var label = _.trim(meta.command.argument);
    var subscriberId = message.chat.id;
    var choices = listFeedCommandChoices(meta.command.name,
        _.partial(feedUtil.isSubscribed, subscriberId));
    if (!choices.length) {
        return {text: 'You are not subscribed to any feeds.'};
    }
    if (!label) {
        return {
            text: 'Which feed would you like to unsubscribe from?',
            reply_markup: makeFeedCommandKeyboard(choices)
        };
    }
    var feed = feeds[label];
    if (!feed) {
        return {text: 'There is no feed labeled "' + label + '".'};
    }
    if (feed.subscriptions[subscriberId]) {
        delete feed.subscriptions[subscriberId];
    }
    return {text: 'Unsubscribed from feed "' + label + '".'};
}

function listFeedCommandChoices(command, predicate) {
    return _(feedUtil.getFeedArray(feeds)).filter(predicate)
    .mapValues(function(feed) {
        return '/' + command + ' ' + feed.label;
    }).toArray().value();
}

function makeFeedCommandKeyboard(choices) {
    return new api.KeyboardBuilder(choices)
        .columns(2).once(true).selective(true).resize(true).build();
}

function extractLabelUrlPair(argument) {
    for (var match, lastUrlMatch = null, regex = urlRegex();
         match = regex.exec(argument);
         lastUrlMatch = match);
    var url = lastUrlMatch ? lastUrlMatch[0] : null;
    var label = url ? argument.substr(0, lastUrlMatch.index).trim() : argument;
    if (url && argument.length - url.length !== lastUrlMatch.index) {
        url = label = null; // There is some trailing text after the url
    }
    return {url: url || null, label: label || null};
}
