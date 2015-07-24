var _ = require('lodash');
var FeedParser = require('feedparser');
var Promise = require('bluebird');
var request = require('request');
var feedUtil = require('./utilities.js');

function Announcer(resources) {

    var log = resources.log, api = resources.api,
        app = resources.app, config = resources.config;
    var feeds = {};
    var labels = [];
    var currentIndex = 0, timer = null;

    this.schedule = function(feedContainer) {
        if (timer) {
            clearInterval(timer);
        }
        if (!feedContainer) {
            return;
        }
        currentIndex = 0;
        feeds = feedContainer;
        labels = _(feedUtil.getFeedArray(feeds))
        .where({enabled: true}).pluck('label').value();
        if (labels.length) {
            var interval = config.interval * 1000 / labels.length;
            timer = setInterval(function() {
                var label = labels[currentIndex];
                var feed = label !== undefined ? feeds[label] : undefined;
                if (!feed) {
                    log.error('Feed "' + label +
                              '" scheduled but does not exist');
                    return;
                }
                if (feed.enabled !== true) {
                    log.error('Feed "' + label +
                              '" scheduled but is not enabled');
                    return;
                }
                checkFeed(feed).catch(function(error) {
                    log.error('Failed to fetch feed "' + label + '":', error);
                });
                currentIndex = (currentIndex + 1) % labels.length;
            }, Math.round(interval));
        }
    };

    function checkFeed(feed) {
        return Promise.try(function() {
            if (_.isEmpty(feed.subscriptions)) {
                feed.lastItemDate = undefined;
                return null;
            }
            return fetchFeed(feed).then(function(result) {
                if (result && result.length) {
                    announceUpdates(feed, result);
                    if (feed.updateCount !== undefined) {
                        feed.updateCount += result.length;
                    } else {
                        feed.updateCount = result.length;
                    }
                    return result.length;
                }
                return 0;
            }).catch(function(error) {
                if (feed.errorCount !== undefined) {
                    feed.errorCount++;
                } else {
                    feed.errorCount = 1;
                }
                feed.lastErrorDate = new Date().toJSON();
                throw error;
            });
        });
    }

    function announceUpdates(feed, updates) {
        var digest = [];
        var maxSize = Number(config.maxDigestSize);
        updates.slice(0, maxSize).forEach(function(update) {
            var formattedEntry = formatEntry(update);
            if (formattedEntry) {
                digest.unshift(formattedEntry);
            }
        });
        var digestText = digest.join("\n\n");
        if (!digestText.length) {
            return;
        }
        if (updates.length > maxSize) {
            digestText += "\n\n(" + String(updates.length - maxSize) +
                          ' older update(s) skipped)';
        }
        _.forEach(feed.subscriptions, function(data, subscriber) {
            api.sendMessage({
                chat_id: subscriber,
                text: digestText
            });
        });
    }

    function fetchFeed(feed) {
        return new Promise(function(resolve, reject) {
            var customHeaders = {
                'User-Agent': app.identifier,
                'Accept': 'application/xml,text/xml,application/xhtml+xml,' +
                          'application/atom+xml,text/html'
            };
            if (feed.eTag) {
                customHeaders['If-None-Match'] = feed.eTag;
            } else if (feed.lastModifed) {
                customHeaders['If-Modified-Since'] = feed.lastModifed;
            }
            var reqOptions = {
                method: 'GET',
                url: feed.url,
                gzip: true,
                strictSSL: false,
                timeout: config.requestTimeout * 1000,
                headers: customHeaders
            };

            var pendingRequest = request(reqOptions).on('error', function(error) {
                reject({httpError: error});
            }).on('response', function(response) {
                var headers = response.headers, status = response.statusCode;

                if (status === 304) {
                    resolve(null);
                    return;
                } else if (status !== 200) {
                    reject({
                        httpStatus: status,
                        httpHeaders: headers
                    });
                    return;
                }
                if (headers['etag']) {
                    feed.eTag = headers['etag'];
                }
                if (headers['last-modified']) {
                    feed.lastModified = headers['last-modified'];
                }
                resolve(parseFeed(feed, pendingRequest));
            });
        });
    }

    function parseFeed(feed, stream) {
        return new Promise(function(resolve, reject) {
            var entries = [];
            var parserErrors = [];
            var latestItemDate = parseJsonDate(feed.latestItemDate);
            var newLatestItemDate = parseJsonDate(feed.latestItemDate);
            var parser = new FeedParser({
                feedurl: feed.url
            });
            parser.on('error', function(error) {
                parserErrors.push(error);
            });
            parser.on('end', function() {
                if (parserErrors.length) {
                    reject({
                        parserErrors: parserErrors,
                        partial: entries
                    });
                } else {
                    resolve(entries);
                }
            });
            parser.on('readable', function() {
                var entry;
                while (entry = this.read()) {
                    var date = entry.pubdate || entry.date;
                    if (date && (!newLatestItemDate || date > newLatestItemDate)) {
                        newLatestItemDate = date;
                        feed.latestItemDate = date.toJSON();
                    }
                    if (date && latestItemDate && date > latestItemDate) {
                        entries.push(entry);
                    }
                }
            });
            stream.pipe(parser);
        });
    }
}

function parseJsonDate(str) {
    return str ? new Date(str) : null;
}

function formatEntry(entry) {
    var meta = entry.meta;
    var leadin = entry.author ? entry.author  : 'New entry';
    var feedTitle = meta.title || '<missing title>';
    var entryTitle = entry.title ? entry.title +  " \u2014 " : '';
    var link = entry.link || '<missing url>';
    return "\u00BB " + leadin + " published on channel \u201C" + feedTitle +
           "\u201D:\n" + entryTitle + link;
}

module.exports = Announcer;
