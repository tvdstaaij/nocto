// Any equire calls to the module dependencies for this plugin go here.
// Make sure to add modules that aren't covered by the bot dependencies to the
// package.json file in this directory.

// Every plugin exports a loadPlugin function.
// This function will be called when the plugin is (re)loaded.
module.exports = function loadPlugin(resources, services) {

    // The plugin is provided with a number of resources to access various
    // bot functions. You can define shorthand references like done below.
    // Resources are always provided, services may be disabled.
    var log = resources.log; // log4js logging system
    var api = resources.api; // Telegram API call functions provided by lib/tgbot.js
    var config = resources.config; // Plugin-local static configuration (see ./config.json)
    var pjson = resources.pjson; // The data from ./package.json if it exists
    var emoji = services.emoji; // Utility functions for working with emoji
    
    // This is a good spot for plugin-local functions, these are invisible to the
    // main system. Let's define one for optionally reversing the echoed string.    
    function reverse(string) {
        return string.split('').reverse().join('');
    }
    
    // Don't do unnecessary init stuff here, leave this up to the 'enable' handler
    // function defined below. This function should return as soon as possible.
    
    // The loadPlugin function returns an object of handler functions.
    // The enable and disable handlers are mandatory.
    return {

        // The enable function provides an init sequence that is executed before
        // any events are received. Any I/O and other long operations must be 
        // performed asynchronously. Then call cb(error, result) when everything
        // is done. For this plugin there is really nothing interesting to do.
        enable: function(cb) {
            // Since this function is expected to behave asynchronously, the
            // callback may not be called immediately. If there are no
            // asynchronous actions to perform you can just wrap it into
            // a node.js process.nextTick call.
            process.nextTick(function() {
                cb(null, true);
            });
        },

        // The disable handler follows the same rules as the enable handler and
        // should do any necessary cleanup operations. It will be called when
        // the plugin is disabled by an admin and before a clean shutdown.
        disable: function(cb) {
            process.nextTick(function() {
                cb(null, true);
            });
        },

        // Called when the plugin is enabled and a new message is available.
        // The message object contains the raw data as specified in the Telegram
        // bot API documentation, meta contains some useful additional data.
        // This handler must not block; make sure I/O and other long operations
        // are performed asynchronously. The bot does *not check* on this
        // functions progress, use timeouts and such to make sure its asynchronous
        // operations are completed within a reasonable amount of time.
        handleMessage: function(message, meta) {
            if (!meta.command || // This message was not detected as a bot command
                !meta.fresh) { // This is a backlog message (sent before the bot was started)
                return;
            }
            
            // Let's handle this message if it's detected as an 'echo' command.
            var command = meta.command;
            if (command.name.toLowerCase() === 'echo') {

                var text = command.argument;

                // Reverse the string depending on configuration
                if (config.reverse) {
                    text = reverse(text);
                }

                // If the emoji service is available, use it for an emoji
                // variant generator feature
                if (emoji) {
                    text = emoji.applySkinVariants(text);
                }

                // Initiate an API call to echo the message back.
                // Note that this returns immediately, the actual call is
                // performed asynchronously.
                // The callback argument or a Q promise chain can optionally be
                // used if you need control over the result (e.g. success check
                // or sequential calls), as done below.
                api.sendMessage({
                    chat_id: message.chat.id,
                    text: text
                }, function(error, result) {
                    // It is also possible to use the bots central logging system
                    // with various log levels (see log4js documentation).
                    // But try not to spam the logs too much.
                    if (error) {
                        log.trace('[echo] Failed sending echoed message', error);
                    }
                });

            }
        }
    
    };
};
