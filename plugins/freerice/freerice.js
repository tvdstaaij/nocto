var _ = require('lodash');
var Promise = require('bluebird');
var FreericeApi = require('./lib/frapi');

var config, api, freerice, emoji;
var handlers = {};

module.exports = function loadPlugin(resources, service) {
    config = resources.config;
    api = resources.api;
    freerice = new FreericeApi(config);
    emoji = service('emoji');
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    var command = meta.command;
    if (!command || !meta.fresh) return;

    var reply = new api.MessageBuilder(message.chat.id).markdown();
    var sink = _.partial(outputResult, reply);

    var chain = Promise.bind(freerice);
    if (command.name === 'fr' || command.name === 'freerice') {
        if (command.argumentTokens.length) {
            if (_.endsWith(command.argumentTokens[0], 'subject')) {
                var subject = command.argumentTokens[1].toLowerCase();
                chain = chain.then(_.partial(freerice.changeSubject, subject));
            } else if (_.endsWith(command.argumentTokens[0], 'level')) {
                var level = Number(command.argumentTokens[1]);
                chain = chain.then(_.partial(freerice.changeLevel, level));
            } else {
                return;
            }
        }
        chain.then(freerice.fetch).then(sink);
        return;
    }

    var selectedAnswer = null;
    var numericCommand = Number(command.name);
    if (_.isFinite(numericCommand)) {
        selectedAnswer = numericCommand - 1;
    } else {
        selectedAnswer = freerice.getNumberForAnswer(command.name);
    }
    if (_.isNumber(selectedAnswer)) {
        freerice.fetch(selectedAnswer).then(sink);
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
    reply.text(text).send();
}
