var emojiData = require('emoji-data');
var emojiRegex = require('emoji-regex');
var extend = require('util-extend');
var log4js = require('log4js');

var log = log4js.getLogger('services');

var properties = {data: emojiData};
var methods = {};

methods.injectReal = function(text) {
    return text.replace(/:([a-z0-9_+\-]+):/ig, function(match, shortName) {
        var char = emojiData.from_short_name(shortName);
        if (char) {
            return char.render();
        }
        return match;
    });
};

methods.injectShortNames = function(text) {
    return text.replace(emojiRegex(), function(match) {
        var char = emojiData.scan(match);
        if (char && char.length === 1) {
            return ':' + char[0].short_name + ':';
        }
        return match;
    });
};

module.exports.provides = function() {
    return extend(properties, methods);
};
