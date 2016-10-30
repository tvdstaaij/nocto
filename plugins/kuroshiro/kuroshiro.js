var Promise = require ('bluebird');
var Kuroshiro = require ('kuroshiro');

var log, api, config;
var handlers = {};

module.exports = (resources) =>
{
	log = resources.log;
	api = resources.api;
	config = resources.config;
	
	return handlers;
};

handlers.enable = (cb) =>
{
	Kuroshiro.init
	(
		(error) =>
		{
			if (error)
				cb (error);
			
			return Promise.resolve ().asCallback (cb);
		}
	);
};

handlers.handleMessage = (message, meta) =>
{
	if (! meta.command || ! meta.fresh)
		return;
	
	var command = meta.command;
	var result;
	switch (command.name.toLowerCase ())
	{
		case 'katakana':
			result = Kuroshiro.toKatakana (command.argument);
			break;
		case 'hiragana':
			result = Kuroshiro.toHiragana (command.argument);
			break;
		case 'romaji':
			result = Kuroshiro.toRomaji (command.argument);
			break;
		case 'kana':
			result = Kuroshiro.toKana (command.argument);
			break;
	}
	
	if (result)
		return msg (message.chat.id, result);
};

function msg (chatId, text)
{
	return api.sendMessage
	(
		{
			chat_id: chatId,
			text: text
		},
		(error, result) =>
		{
			if (error)
				log.trace ('[kuroshiro] Failed to send message', error);
		}
	)
}