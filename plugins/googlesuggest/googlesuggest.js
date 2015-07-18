var Q = require('q');
var request = require('request');
var xml2js = require('xml2js');

var api, app, config;
var handlers = {};

module.exports = function loadPlugin(resources) {
    api = resources.api;
    config = resources.config;
    app = resources.app;
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    var command = meta.command;
    if (!meta.fresh || !command) {
        return;
    }
    var match = command.name.match(/^(g|google)?suggest[^a-z]*([a-z]*)$/i);
    var query = command.argument;
    if (match && query) {
        var reply = '';
        fetchSuggestions(query, match[2] || config.defaultLanguage).then(
            function(suggestions) {
                reply = suggestions.length ? suggestions.join("\n") :
                        'No suggestions';
            }, function() {
                reply = 'Failed to fetch suggestions';
            }
        ).then(function() {
            api.sendMessage({
                chat_id: message.chat.id,
                text: reply
            });
        }).done();
    }
};

function fetchSuggestions(query, language) {
    var deferred = Q.defer();
    var reqOptions = {
        method: 'GET',
        uri: config.requestUri,
        gzip: true,
        strictSSL: true,
        headers: {
            'Accept': 'text/xml,application/xml,application/xhtml+xml',
            'User-Agent': app.identifier
        },
        qs: {
            'hl': language.substr(0, 2),
            'output': 'toolbar',
            'q': query
        }
    };
    request(reqOptions, function(error, response, body) {
        if (error || response.statusCode !== 200) {
            deferred.reject({
                error: error || undefined,
                status: response.status || undefined,
                headers: response.headers || undefined
            });
            return;
        }
        xml2js.parseString(body, {
            explicitRoot: false,
            normalizeTags: true
        }, function (error, xml) {
            if (error) {
                deferred.reject({
                    xmlerror: error
                });
                return;
            }
            var suggestions = [];
            (xml.completesuggestion || []).forEach(
                function(completeSuggestion) {
                    completeSuggestion = completeSuggestion || {};
                    (completeSuggestion.suggestion || []).forEach(
                        function (suggestion) {
                            var attr = suggestion.$ || {};
                            var text = attr.data;
                            if (text &&
                                text.toLowerCase() !== query.toLowerCase()) {
                                suggestions.push(text);
                            }
                        }
                    );
                }
            );
            deferred.resolve(suggestions);
        });
    });
    return deferred.promise;
}
