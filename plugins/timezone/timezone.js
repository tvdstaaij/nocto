var Promise = require ('bluebird');
var Moment = require ('moment');
var Timezone = require ('moment-timezone');

var log, api, config;
var handlers = {};
var zones = {};

module.exports = (resources) =>
{
	log = resources.log;
	api = resources.api;
	config = resources.config;
	
	return handlers;
};

handlers.enable = (cb) =>
{
	var names = Moment.tz.names ();
	
	for (var i = 0; i < names.length; i++)
	{
		zones[names[i].toLowerCase ()] = names[i];
		
		if (names[i].indexOf ('/') > 0)
		{
			var parts = names[i].split ('/');
			
			zones[parts[1].toLowerCase ()] = names[i];
		}
	}
	
	return Promise.resolve().asCallback (cb);
};

handlers.handleMessage = (message, meta) =>
{
	if (! meta.command || ! meta.fresh)
		return;
	
	var command = meta.command;
	if (['tz', 'timezone', 'time'].indexOf (command.name.toLowerCase ()) !== - 1)
	{
		if (! command.argument)
			return msg (message.chat.id, 'No timezone specified');
		
		if (! zones[command.argument])
			return msg (message.chat.id, 'Unknown timezone');
		
		var timezone = zones[command.argument.toLowerCase ()];
		var time = Moment.tz (new Date (), timezone).format (config.format);
		
		return msg (message.chat.id, timezone + ': ' + time);
	}
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
				log.trace ('[timezone] Failed to send message', error);
		}
	)
}
