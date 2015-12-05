var _ = require('lodash');
var config = require('config');
var Promise = require('bluebird');
var TokenBucket = require('tokenbucket');
var botUtil = require('../lib/utilities.js');

var log;
var svcConfig = _.get(config, 'services.config.throttle') || {};
var users = {};

module.exports.init = function(resources, service) {
    log = resources.log;
    return botUtil.loadServiceDependencies(['userdata'], service);
};

module.exports.filterMessage = function(message, meta) {
    // This authority level is exempt: instant accept
    if (svcConfig.grantImmunity && meta.authority &&
        meta.authority.isAtLeast(svcConfig.grantImmunity)) {
        return true;
    }

    // Get or create a token bucket specific for this user
    var sender = message.from.id;
    var user = users[sender] =
        users[sender] || {
            queueSize: 0,
            bucket: new TokenBucket({
                interval: svcConfig.rate[1] * 1000,
                tokensToAddPerInterval: svcConfig.rate[0],
                size: svcConfig.burst,
                spread: true
            })
        };

    // Too many messages are already being delayed: instant reject
    if (user.queueSize >= svcConfig.queueLimit) {
        return false;
    }

    // Tokens can be claimed without delay: instant accept
    if (user.bucket.removeTokensSync(1)) {
        return true;
    }

    // Register message as queued and accept it after a delay
    user.queueSize++;
    return user.bucket.removeTokens(1)
        .return(true)
        .finally(function() {
            user.queueSize--;
        });
};
