var _ = require('lodash');
var cowsay = require('cowsay');
var crypto = require('crypto');

var log, api, config, cows;
var handlers = {};

module.exports = function loadPlugin(resources) {
    log = resources.log;
    api = resources.api;
    config = resources.config;
    return handlers;
};

handlers.enable = function(cb) {
    cowsay.list(function(err, result) {
        if (!_.isEmpty(config.whitelist)) {
            cows = _.intersection(result, config.whitelist || []);
        } else {
            cows = _.difference(result, config.blacklist || []);
        }
        if (!err) {
            _.forEach(cows, function (cow) {
                cowsay.say({f: cow, text: 'a'});
            });
            cows.sort(function(a, b) {
                function determineScore(v) {
                    switch (v) {
                        case 'default': return -3;
                        case 'tux': return -2;
                        case 'sheep': return -1;
                        default: return v.length;
                    }
                }
                var scoreDelta = determineScore(a) - determineScore(b);
                if (scoreDelta) return scoreDelta;
                if (a < b) return -1;
                if (a > b) return 1;
                return 0;
            });
            log.info('Loaded ' + cows.length + ' cows');
        }
        cb(err);
    });
};

handlers.handleInlineQuery = function(message) {
    var text = message.query;

    var results = _.chain(cows)
        .map(function(cow) {
            if (!text) return null;

            var uniqueId = cow + text;
            var hash = crypto.createHash('md5')
                .update(uniqueId).digest('hex');

            var output = cowsay.say({f: cow, text: text});

            if (!output.trim()) return null;
            if (output.indexOf('```') !== -1) return null;
            output = '```\n\u200B' + output + '\n```';
            if (output.length > config.maxOutputLength) return null;

            var cowLabel = cow === 'default' ? 'cow' : cow;
            cowLabel = _.upperFirst(cowLabel.replace(/-/g, ' '));
            return {
                type: 'article',
                id: hash,
                title: cowLabel,
                parse_mode: 'Markdown',
                message_text: output,
                thumb_url: config.thumbLocation ?
                    config.thumbLocation + '/' + cow + config.thumbExt :
                    undefined
            };
      })
      .compact()
      .slice(0, 50)
      .value();

    if (results.length) {
      log.trace('Generated cows: ' + JSON.stringify({
        text: text,
        user: message.from
      }));
    }
    api.answerInlineQuery({
        inline_query_id: message.id,
        results: results
    });
};
