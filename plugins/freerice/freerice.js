var _ = require('lodash');
var path = require('path');
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var FreericeApi = require('./lib/frapi');
var resultMessages = require('./lib/result-messages');
var subjects = require('./lib/subjects');

var config, api, emoji, db, log;
var handlers = {};
var games = {};

module.exports = function loadPlugin(resources, service) {
    config = resources.config;
    api = resources.api;
    log = resources.log;
    emoji = service('emoji');
    db = service('sqlite');
    return handlers;
};

handlers.enable = function(cb) {
    fs.readFileAsync(path.join(__dirname, 'lib', 'sqlite-tables.sql'))
        .then(function(sql) {
            return db.execAsync(sql.toString());
        })
        .nodeify(cb);
};

handlers.handleMessage = function(message, meta) {
    var command = meta.command;
    if (!meta.fresh || !message.text) return;

    var reply = new api.MessageBuilder(message.chat.id).markdown();
    var sink = _.partial(outputResult, reply);
    var game = games[message.chat.id];
    var freerice = game ? game.freerice : null;
    var operation = null;
    var newSubject = null;

    if (command && (command.name === 'fr' || command.name === 'freerice')) {
        if (command.argumentTokens.length) {
            if (_.endsWith(command.argumentTokens[0], 'subject') ||
                _.endsWith(command.argumentTokens[0], 'subjects')) {
                operation = 'listsubjects';
            } else if (_.endsWith(command.argumentTokens[0], 'level')) {
                operation = 'setlevel';
            } else if (command.argumentTokens[0] === 'reset') {
                game = null;
                operation = 'reset';
            }
        } else {
            operation = 'fetch';
        }
    } else if (_.isString(newSubject = subjects[message.text])) {
        operation = 'setsubject';
    }

    if (operation !== null) {
        if (game && game.locked) return;
        if (!game) {
            game = games[message.chat.id] = {
                subject: null,
                freerice: new FreericeApi(config),
                question: null,
                locked: false,
                rounds: 0
            };
            freerice = game.freerice;
        }
        var chain = Promise.bind(freerice);
        if (game.subject === null && operation !== 'setsubject') {
            chain = chain.then(_.partial(freerice.changeSubject,
                config.defaultSubject));
            game.subject = config.defaultSubject;
        }
        switch (operation) {
            case 'listsubjects':
                var subjectStrings = _.keys(subjects);
                var text = '*Available subjects:* ' + subjectStrings.join(', ');
                var keyboard = new api.KeyboardBuilder(subjectStrings)
                    .resize(true).selective(true);
                return reply.reply(message.message_id).text(text)
                    .keyboard(keyboard.build()).send();
            case 'setsubject':
                chain = chain
                    .then(_.partial(freerice.changeSubject, newSubject))
                    .then(function() {
                        game.subject = newSubject;
                    });
                break;
            case 'setlevel':
                var level = Number(command.argumentTokens[1]);
                chain = chain.then(_.partial(freerice.changeLevel, level));
                break;
        }
        game.locked = true;
        chain.then(freerice.fetch)
            .then(function(question) {
                game.question = question;
                return game;
            })
            .then(sink)
            .finally(function() {
                game.locked = false;
            });
        return;
    }

    if (!freerice) return;
    var selectedAnswer = freerice.getNumberForAnswer(message.text.trim());
    if (_.isNumber(selectedAnswer)) {
        game.locked = true;
        freerice.fetch(selectedAnswer)
            .then(function(question) {
                var result = question.result;
                game.previous = game.question;
                game.question = question;
                sink(game, message.from);

                var level = game.previous.currentLevel;
                if (!level && !game.rounds) {
                    level = 1;
                }
                game.rounds++;
                return db.runAsync(
                    'INSERT INTO fr_rounds (tg_user, correct, gains, ' +
                    'subject, level) ' +
                    'VALUES (?, ?, ?, ?, ?);',
                    [message.from.id, result.correct, result.gains,
                     game.subject, level]
                );
            })
            .finally(function() {
                game.locked = false;
            });
    }
};

function outputResult(reply, game, user) {
    var text = '';
    var question = game.question;
    var result = question.result;
    if (result && user) {
        text += emoji.fromBoolean(result.correct);
        var messagePool = result.correct ?
            resultMessages.good : resultMessages.bad;
        var suffix = result.correct ? '!' : '.';
        text += ' _' + _.sample(messagePool) + ' ' + user.first_name + suffix;
        text += '_ ' + api.escapeMarkdown(_.upperFirst(result.prompt)) + ' = ';
        text += result.answer + '.';
        var prevLevel = _.get(game, 'previous.currentLevel');
        var curLevel = question.currentLevel;
        if (prevLevel && curLevel && prevLevel !== curLevel) {
            text += ' We are now playing on *level ' + curLevel + '*.';
        }
        text += '\n\n';
    }
    var prompt = _.upperFirst(question.prompt);
    var title = _.upperFirst(question.title);
    var formattedQuestion = api.escapeMarkdown(title)
        .replace(prompt, '*' + api.escapeMarkdown(prompt) + '*');
    text += formattedQuestion + '\n\n';
    text += api.escapeMarkdown(question.answers.join(' / '));
    var keyboard = new api.KeyboardBuilder(question.answers).resize(true);
    reply.text(text).keyboard(keyboard.build()).send();
}
