var _ = require('lodash');
var path = require('path');
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var FreericeApi = require('./lib/frapi');

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
    if (!meta.fresh) return;

    var reply = new api.MessageBuilder(message.chat.id).markdown();
    var sink = _.partial(outputResult, reply);
    var game = games[message.chat.id];
    var freerice = game ? game.freerice : null;

    if (command && (command.name === 'fr' || command.name === 'freerice')) {
        var operation = null;
        if (command.argumentTokens.length) {
            if (_.endsWith(command.argumentTokens[0], 'subject')) {
                operation = 'subject';
            } else if (_.endsWith(command.argumentTokens[0], 'level')) {
                operation = 'level';
            } else if (command.argumentTokens[0] === 'reset') {
                game = null;
            } else {
                return;
            }
        }

        if (game && game.locked && operation !== 'reset') return;
        if (!game) {
            game = games[message.chat.id] = {
                subject: config.defaultSubject,
                freerice: new FreericeApi(config),
                question: null,
                locked: false,
                rounds: 0
            };
            freerice = game.freerice;
        }
        var chain = Promise.bind(freerice);
        if (operation !== 'subject') {
            chain = chain.then(_.partial(freerice.changeSubject,
                config.defaultSubject));
        }
        switch (operation) {
            case 'subject':
                var subject = command.argumentTokens[1].toLowerCase();
                chain = chain.then(_.partial(freerice.changeSubject, subject));
                break;
            case 'level':
                var level = Number(command.argumentTokens[1]);
                chain = chain.then(_.partial(freerice.changeLevel, level));
                break;
        }
        game.locked = true;
        chain.then(freerice.fetch)
            .then(function(question) {
                return (game.question = question);
            })
            .then(sink)
            .finally(function() {
                game.locked = false;
            });
        return;
    }

    if (!freerice || !message.text) return;
    var selectedAnswer = freerice.getNumberForAnswer(message.text.trim());
    if (_.isNumber(selectedAnswer)) {
        game.locked = true;
        freerice.fetch(selectedAnswer)
            .then(function(question) {
                var result = question.result;
                var previous = game.question;
                game.question = question;
                sink(question);

                var level = previous.currentLevel;
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

function outputResult(reply, question) {
    var text = '';
    if (question.result) {
        text += emoji.fromBoolean(question.result.correct);
        text += ' _' + question.result.raw + '_\n\n';
    }
    var prompt = _.capitalize(question.prompt);
    var title = _.capitalize(question.title);
    var formattedQuestion = api.escapeMarkdown(title)
        .replace(prompt, '*' + prompt + '*');
    text += formattedQuestion + '\n\n';
    text += api.escapeMarkdown(question.answers.join(' / '));
    var keyboard = new api.KeyboardBuilder(question.answers).resize(true);
    reply.text(text).keyboard(keyboard.build()).send();
}
