var _ = require('lodash');
var cheerio = require('cheerio');
var Promise = require('bluebird');
var request = require('request');
var subjects = require('./subjects');

var FREERICE_BASE = 'http://freerice.com';

function FreericeApi(options) {
    this._request = request.defaults({
        forever: true,
        baseUrl: FREERICE_BASE,
        gzip: true,
        headers: {
            'User-Agent': options.userAgent || 'request',
            'DNT': '1',
            'Referer': FREERICE_BASE + '/'
        },
        jar: request.jar()
    });
}

FreericeApi.SUBJECTS = subjects;

FreericeApi.prototype.fetch = function(answerIndex) {
    var req = {
        url: '/game.php'
    };
    if (_.isNumber(answerIndex) && this.question) {
        req.method = 'POST';
        req.form = {};
        _.assign(req.form, this._params, {
            answer: String(answerIndex),
            op: 'next',
            language: ''
        });
    } else {
        req.method = 'GET';
    }

    return this._invokeRequest(req)
        .bind(this).then(this._parse);
};

FreericeApi.prototype.changeLevel = function(level) {
    level = String(Number(level));
    return this._doCommandRequest('/set_level/' + level);
};

FreericeApi.prototype.changeSubject = function(subject) {
    subject = String(Number(subject));
    return this._doCommandRequest('/frapi/category_selected/' + subject);
};

FreericeApi.prototype._doCommandRequest = function(route) {
    return this._invokeRequest({
        method: 'GET',
        url: route
    }).return();
};

FreericeApi.prototype._invokeRequest = function(req) {
    return Promise.fromNode(this._request.bind(this._request, req))
        .spread(extractBody);
};

FreericeApi.prototype.getNumberForAnswer = function(answer) {
    if (!this.question || _.isEmpty(this.question.answers)) return null;
    answer = String(answer).toLowerCase().replace(/\s/g, '');
    var match = _.findIndex(this.question.answers, function(candidate) {
        candidate = String(candidate).toLowerCase().replace(/\s/g, '');
        if (candidate === answer) return true;
        // Todo: handle long answers
    });
    return match >= 0 ? match : null;
};

FreericeApi.prototype._parse = function(body) {
    var question = {};
    var $ = cheerio.load(body);

    var answers = [];
    $('a.answer-item').each(function() {
        answers.push($(this).text());
    });

    var params = {};
    $('input[type=hidden]').each(function() {
        var elem = $(this);
        var key = elem.attr('name');
        if (!_.isEmpty(key)) {
            params[key] = elem.val() || '';
        }
    });
    params.nb = $('#nb').val() || '0';

    var result = null;
    var resultRegex = /^\s*(in)?correct[ !]+([^=]+)=(.+)/i;
    $('#game-status').find('*').each(function() {
        var text = $(this).text();
        var resultMatch = resultRegex.exec(text);
        if (resultMatch) {
            result = {
                raw: resultMatch[0].trim(),
                correct: !resultMatch[1],
                prompt: resultMatch[2].trim(),
                answer: resultMatch[3].trim(),
                gains:
                    Number(_.last(/donated\s+(\d+)\s+grains/i.exec(body)) || 0)
            };
            return false;
        }
    });
    question.result = result;

    this._params = params;
    question.answers = answers;
    question.prompt = $('#question-title b').text() || '';
    question.title = $('#question-title .question-link').text() || '';

    question.currentLevel = null;
    question.maxLevel = null;
    var levelRegex = /^\s*level[^\d]+(\d+)[^\d]+(\d+)/i;
    $('.block-bottom li').each(function() {
        var match = levelRegex.exec($(this).text());
        if (match) {
            question.currentLevel = Number(match[1]);
            question.maxLevel = Number(match[2]);
            return false;
        }
    });

    return (this.question = question);
};

function extractBody(res, body) {
    if (res.statusCode !== 200) {
        throw new Error('HTTP' + String(res.statusCode));
    }
    return body;
}

module.exports = FreericeApi;
