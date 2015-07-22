var _ = require('underscore');
var botUtil = require('../lib/utilities.js');

var api, storage, users;

var authoritySymbols = ['b', '-', '+', '%', '@', '&', '~'];
var authorityNames = ['blacklisted', 'user', 'trusted', 'half-operator',
                      'operator', 'administrator', 'owner'];
var authorityLevelsBySymbol = _.invert(authoritySymbols);
var authorityLevelsByName = _.invert(authorityNames);

module.exports.init = function(resources, service) {
    var persist;
    api = resources.bot.api;
    return botUtil.loadServiceDependencies(['persist'], service)
    .then(function(services) {
        persist = services.persist;
    })
    .then(function() {
        return persist.load();
    })
    .then(function(container) {
        storage = container;
        storage.users = storage.users || {};
        users = storage.users;
    });
};

module.exports.provides = function(context) {
    function getUserData(recordPair) {
        return recordPair ?
            new UserData(recordPair[0], recordPair[1], context) : undefined;
    }
    return {
        id: function(id) {
            return getUserData(getRecordById(id));
        },
        name: function(name) {
            return getUserData(getRecordByUserName(name));
        },
        UserAuthority: UserAuthority,
        authoritySymbols: authoritySymbols,
        authorityLevelsBySymbol: authorityLevelsBySymbol,
        authorityNames: authorityNames
    };
};

module.exports.filterMessge = function(message, meta) {
    var sender = message.from;
    var userRecord = users[sender.id];
    if (!userRecord) {
        userRecord = users[sender.id] = {};
        userRecord.firstSeen = meta.sendDate.toJSON();
        userRecord.authorityLevel = authorityLevelsBySymbol[''];
    }
    userRecord.userName = sender.username || null;
    userRecord.firstName = sender.first_name || null;
    userRecord.lastName = sender.last_name || null;
};

module.exports.handleMessage = function(message, meta) {
    if (!meta.command) {
        return;
    }
    var reply = handleCommand(message.from.id, meta.command);
    if (reply) {
        api.sendMessage({
            chat_id: message.chat.id,
            text: reply
        });
    }
};

function handleCommand(userId, command) {
    var reply = null;
    switch (command.name) {
    case 'owner':
        var owner = _.find(users, function(user) {
            return user.authorityLevel.toString() ===
                   authorityLevelsBySymbol['~'];
        });
        if (owner === undefined) {
            var user = users[userId];
            if (user) {
                user.authorityLevel = authorityLevelsBySymbol['~'];
                reply = 'You are now registered as my owner.';
            } else {
                reply = 'Error: could not look up your user ID.';
            }
        } else {
            reply = 'I already have an owner.';
        }
        break;
    case 'blacklist':
    case 'ban':
        reply = handleAuthorityCommand(userId, command.argumentTokens[0], 'b');
        break;
    case 'authority':
        reply = handleAuthorityCommand(userId, command.argumentTokens[0],
                                       command.argumentTokens[1]);
        break;
    }
    return reply;
}

function handleAuthorityCommand(commandUserId, targetSpec, authoritySpec) {
    var commandUser = users[commandUserId];
    if (!commandUser) {
        return 'I could not find your own user record.';
    }
    var commandAuthority = new UserAuthority(commandUser.authorityLevel);
    var targetRecord = null;
    if (targetSpec) {
        if (targetSpec.length && targetSpec[0] === '@') {
            targetRecord = getRecordByUserName(targetSpec);
        } else {
            targetRecord = getRecordById(targetSpec);
        }
        if (targetRecord) {
            targetRecord = targetRecord[1];
        }
    }
    if (!targetRecord) {
        return 'I do not know of this user. Make sure it is a valid ' +
               'numerical ID or @username.';
    }
    if (!authoritySpec) {
        var targetAuthority = new UserAuthority(targetRecord.authorityLevel);
        return 'That user\'s authority is "' + targetAuthority.name() + '" (' +
               'level ' + targetAuthority.level() + ', symbol \'' +
               targetAuthority.symbol() + '\').';
    }
    var newAuthority = new UserAuthority(authoritySpec.toString().
                                         toLowerCase());
    if (newAuthority.level() === null) {
        return 'Invalid authority specification. Try one of: ' +
               authorityNames.join(' ');
    }
    if (!commandAuthority.isAtLeast('%')) {
        return 'You must be half-operator or higher to set authority levels.';
    }
    if (!commandAuthority.isAtLeast(targetRecord.authorityLevel)) {
        return 'Your target must not have a higher authority than you do.';
    }
    if ((newAuthority.equals('%') && !commandAuthority.isAtLeast('@')) ||
        !commandAuthority.isAtLeast(newAuthority)) {
        return 'Your own authority is insufficient to grant this authority.';
    }
    targetRecord.authorityLevel = newAuthority.level();
    return 'Authority level set to "' + newAuthority.name() + '".';
}

function getRecordById(id) {
    var record = users[id];
    return record ? [id, record] : undefined;
}

function getRecordByUserName(name) {
    if (!name) {
        return undefined;
    }
    name = name.toString();
    if (name.length && name[0] === '@') {
        name = name.substr(1);
    }
    var recordPair = _.find(_.pairs(users), function(recordPair) {
        return recordPair[1].userName === name;
    });
    return recordPair ? recordPair : undefined;
}

function UserData(id, record, context) {
    this.id = id;
    this.userName = record.userName;
    this.firstName = record.firstName;
    this.lastName = record.lastName;
    this.firstSeen = record.firstSeen ? new Date(record.firstSeen) : null;
    this.authority = new UserAuthority(record.authorityLevel);
    if (context) {
        record.contexts = record.contexts || {};
        this.contextual = record.contexts[context] =
            record.contexts[context] || {};
    }
}

function UserAuthority(specification) {
    if (specification && specification._level !== undefined) {
        this._level = specification._level;
    } else {
        this._level = specification ? UserAuthority.resolveToLevel(
            specification.toString().toLowerCase()
        ) : null;
    }
    if (this._level !== null) {
        this._level = this._level.toString();
    }
}

UserAuthority.resolveToLevel = function(specification) {
    var level;
    if (authoritySymbols[specification] !== undefined) {
        return specification;
    }
    level = authorityLevelsBySymbol[specification];
    if (level !== undefined) {
        return level;
    }
    level = authorityLevelsByName[specification.toString().toLowerCase()];
    if (level !== undefined) {
        return level;
    }
    return null;
};

UserAuthority.prototype.level = function() {
    return this._level;
};

UserAuthority.prototype.symbol = function() {
    return this._level === null ? null : authoritySymbols[this._level];
};

UserAuthority.prototype.name = function() {
    return this._level === null ? null : authorityNames[this._level];
};

UserAuthority.prototype.isAtLeast = function(minimalAuthority) {
    var reference = (new UserAuthority(minimalAuthority)).level();
    return this._level !== null && reference !== null &&
           this._level >= reference;
};

UserAuthority.prototype.equals = function(otherAuthority) {
    return this._level !== null &&
           this._level === (new UserAuthority(otherAuthority)).level();
};
