var _ = require('lodash');
var botUtil = require('../lib/utilities.js');

var log, userdata, rules;
var botHasOwner = null;

var logPriorityError = _.once(function() {
    log.error('Message is missing authority field. Make sure the userdata' +
              ' service is loaded with higher priority than this service.');
});

module.exports.init = function(resources, service) {
    log = resources.log;
    rules = resources.config.get('services.config.firewall.rules');
    return botUtil.loadServiceDependencies(['userdata'], service)
        .then(function(services) {
            userdata = services.userdata;
            _.forEach(rules, function(rule) {
                var authority = new userdata.UserAuthority(rule);
                if (authority.level() === null && rule !== '!' &&
                    rule.toLowerCase() !== 'known') {
                    log.error('Bad firewall rule: "' + rule + '" is not valid');
                }
            });
        });
};

module.exports.filterMessage = function(message, meta) {
    if (!botHasOwner) {
        botHasOwner = (userdata.owner() !== null);
        if (!botHasOwner) {
            return true;
        }
    }
    var requiredAuthority;
    if (meta.command && meta.private) {
        requiredAuthority = rules.privateCommand;
    } else if (meta.command) {
        requiredAuthority = rules.groupCommand;
    } else if (meta.private) {
        requiredAuthority = rules.privateMessage;
    } else {
        requiredAuthority = rules.groupMessage;
    }
    var requiredLevel = new userdata.UserAuthority(requiredAuthority);
    if (requiredAuthority === 'known') {
        requiredAuthority = '!';
    }

    if (meta.authority) {
        if (meta.authority.isAtLeast(requiredLevel)) {
            return true;
        }
    } else {
        logPriorityError();
    }
    if (requiredLevel.equals('b')) {
        return true;
    }
    requiredAuthority = requiredAuthority.toLowerCase();
    if (requiredAuthority === '!') {
        var user = userdata.id(message.from.id);
        if (user.authority.isAtLeast('-') &&
            (!_(user.groups).toArray().compact().isEmpty() ||
             user.authority.isAtLeast('+'))) {
            return true;
        }
    }

    var chatDesc = meta.private ?
        'private chat' : 'chat ' + JSON.stringify(message.chat);
    log.trace('Firewall rejected message from user ' +
              JSON.stringify(message.from) + ' in ' + chatDesc);
    return false;
};
