var _ = require('underscore');
var botUtil = require('../lib/utilities.js');

var api, storage, users;

var authoritySymbols = ['b', '', '+', '%', '@', '&', '~'];
var authorityNames = ['Blacklisted', 'User', 'Trusted', 'Half-operator',
                      'Operator', 'Administrator', 'Founder'];
var authorityLevels = _.invert(authoritySymbols);

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

    function getUserData(id, record) {
        return record ? new UserData(id, record, context) : undefined;
    }

    function getUserDataById(id) {
        return getUserData(id, users[id]);
    }

    function getUserDataByUserName(name) {
        if (!name) {
            return undefined;
        }
        name = name.toString();
        if (name.length && name[0] === '@') {
            name = name.substr(1);
        }
        var userRecord = _.find(_.pairs(users), function(recordPair) {
            return recordPair[1].userName === name;
        });
        if (!userRecord) {
            return undefined;
        }
        return getUserData(userRecord[0], userRecord[1]);
    }

    return {
        id: getUserDataById,
        name: getUserDataByUserName,
        UserAuthority: UserAuthority,
        authoritySymbols: authoritySymbols,
        authorityLevels: authorityLevels,
        authorityNames: authorityNames
    };
};

module.exports.handleMessage = function(message, meta) {
    var sender = message.from;
    var userRecord = users[sender.id];
    if (!userRecord) {
        userRecord = users[sender.id] = {};
        userRecord.firstSeen = meta.sendDate.toJSON();
        userRecord.authorityLevel = authorityLevels[''];
    }
    userRecord.userName = sender.username || null;
    userRecord.firstName = sender.first_name || null;
    userRecord.lastName = sender.last_name || null;

    if (meta.command) {
        var reply = handleCommand(message.from.id, meta.command);
        if (reply) {
            api.sendMessage({
                chat_id: message.chat.id,
                text: reply
            });
        }
    }
};

function handleCommand(userId, command) {
    var reply = null;
    switch (command.name) {
    case 'owner':
        var owner = _.find(users, function(user) {
            return user.authorityLevel.toString() === authorityLevels['~'];
        });
        if (owner === undefined) {
            var user = users[userId];
            if (user) {
                user.authorityLevel = authorityLevels['~'];
                reply = 'You are now registered as my owner.';
            } else {
                reply = 'Error: could not look up your user ID.';
            }
        } else {
            reply = 'I already have an owner.';
        }
        break;
    }
    return reply;
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
        this._level = UserAuthority.resolveToLevel(specification.toString());
    }
    if (this._level !== null) {
        this._level = this._level.toString();
    }
}

UserAuthority.resolveToLevel = function(specification) {
    if (authoritySymbols[specification] !== undefined) {
        return specification;
    }
    if (authorityLevels[specification] !== undefined) {
        return authorityLevels[specification];
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
