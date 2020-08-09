# nocto.js

Nocto is a Node.js Telegram bot framework with an asynchronous plugin-based
architecture, using the official bot API. It relies on long polling and
 persistent connections to rapidly interact with Telegram.

What can nocto do for you?
* As a user, you can just run nocto with one or more existing plugins.
* As a developer, you can utilize nocto's extensive framework to develop
  custom plugins without having to reinvent the wheel all the time. Nocto
  provides much more functionality than a simple API wrapper does.

## Development status

Mostly functional but not actively maintained. Lots of outdated dependencies.
May or may not be modernized in the future.

## Quickstart

1. Make sure your Node.js interpreter is version 0.12 or higher.
2. Run `./fullinstall.sh` to install core and plugin dependencies with npm.
3. Make sure the user running the bot has read/write permission for the
   directories `logs`, `persist` and `config`.
4. Launch with `node nocto.js` or `npm start`.
5. Answer the questions asked by the first time setup wizard. If you don't have
   an API token yet, request one from @BotFather on Telegram.
6. Get on Telegram and claim ownership of the bot by sending the command
   `/owner` in a private message or a group that the bot is a member of.
7. List available plugins with `/plugins list`. You can enable any number of
   plugins with `/plugins enable plugin1 plugin2`.

After the first run, which is interactive, you can just use your preferred way
to (automatically) launch and keep the application running in the background.
Sending an interrupt signal (Control-C) initiates a clean shutdown.

## Available plugins (incomplete)

* `echo`: Simple example plugin implementing an echo command.
* `feedannounce`: RSS/Atom notifications configurable for either public or
  private use (under heavy development).
* `googleimages`: Shows Google search suggestions for a partial query.
* `googlesuggest`: Grabs an image from Google Images. Optimized for reliability,
  speed and anti-duplication.
* `ircbridge`: Allows you to link IRC channels and Telegram groups, relaying
  messages and events in one or both directions. Supports multiple IRC servers
  and bridge routes.
* `jukebox`: Grabs playable MP3 songs from Prostopleer.
* `trace`: Logs properties of every incoming message to ease plugin development. 

## Administration
Basic plugin control commands:
```
/plugins list
/plugins enable someplugin
/plugins enable all
/plugins disable someplugin
/plugins disable all
/plugins reload someplugin
/plugins reload
```
* You can enter a space-separated lists of plugins for most commands.
* `reload` performs a full disable-unload-load-enable cycle, only
  enabling plugins that were already enabled. Reloading will force reading the
  plugin files from disk, thus applying any changes to the plugin.

Manipulating user authority:
```
/authority @target_user
/authority @target_user administrator
/ban @target_user
```
* Users must have sent at least one message that the bot has seen before they
  can be assigned an authority.
* Authority levels: `user` `trusted` `half-operator` `operator` `administrator`
  `owner` (and `blacklisted`, which is set by `/ban`)
* You can use either user IDs or @usernames.

## Developing new plugins

Plugins have their own directory in `plugins` and at least an executable file
`plugins/myplugin/myplugin.js`. They can optionally have a `config.json`
and/or an NPM `package.json` in the same directory. For now, reference the
annotated `plugins/echo` as an example plugin (although this is not the only
possible style for writing plugins). Your plugin can have its own dependencies, 
submodules and data files if necessary.

Nocto provides various services and utilities, such as persistent storage,
user tracking, fluid builder patterns and state machines for session-based
interaction. These features will be documented at a later time; if you want to
 know how to make use of this take a look at existing plugins or ask the author.

## Logging

Logging is realized with `log4js` and defaults to dumping all messages except
debug information to standard output and daily rotating files. Logging behavior
can be customized in your local configuration file. Refer to the [log4js 
documentation][1] for further details.

## Dependencies

External dependencies on node modules are listed in the `package.json` and can
be automatically resolved with `npm install`. Dependencies listed as optional
are only necessary for certain services (see below), which are enabled by
default but can be disabled in the bot configuration. Plugins have their own
dependencies specified in a package.json and require an `npm install` in their
plugin directory before loading them for the first time.

However, the bot also has internal component dependencies. The bot provides a
set of modules called 'services' which are more tightly coupled to the bot than
 plugins. They generally provide some functionality to plugins and/or other
 components, for example a persistent data store.

Services can be disabled to strip the bot of some weight if you don't need them.
The following applies regarding dependencies:

* Plugins can depend on certain services.
* Services can depend on certain other services (e.g. plugin manager service
  requiring persistent storage for keeping track of enabled plugins).
* Plugins do not depend on other plugins.

[1]: https://github.com/nomiddlename/log4js-node#configuration
