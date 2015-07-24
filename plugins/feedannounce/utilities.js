var _ = require('lodash');

module.exports.getFeedArray = function(feeds) {
    return _.mapValues(feeds, function(feed, label) {
        return _.extend({label: label}, feed);
    });
};

module.exports.isPublicFeed = function(feed) {
    return feed.owner === null;
};

module.exports.isSubscribed = function(id, feed) {
    return _.has(feed.subscriptions, id);
};
