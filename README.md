# nocto.js

Nocto is a Node.js Telegram bot application with an asynchronous plugin-based
architecture, using the official bot API. It relies on long polling to be
rapidly notified of new messages.

This project is under heavy development; consider it a useable alpha version.

## Quickstart

1. Make sure your installed Node.js version is 0.12 or higher.
2. Resolve core bot dependencies with `npm install`.
3. Resolve dependencies for any plugins you wish to use (`npm install` in their
   directory under `plugins`).
4. Create a `config/local.json`, overriding values from `config/default.json`
   where desired. Specifying `api.token` is required. Note that only the `echo`
   plugin is loaded and enabled by default.
5. Make sure the user running the bot has read/write permission for the
   directories `logs` and `persist`, unless you disable these features.
6. Launch with `node nocto.js` or `npm start`. Note: in some operating systems
   the `node` executable is called `nodejs` instead.

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

## Available plugins

* `echo`: Simple example plugin implementing an `/echo <message>` command.
* `ircbridge`: Allows you to link IRC channels and Telegram groups, relaying
  messages and events in one or both directions. Supports multiple IRC servers
  and bridge routes.
* `trace`: Logs properties of every incoming message to ease plugin development. 

Currently, the only way to enable plugins is to add them to the `autoEnabled`
list in the bot configuration. In the future it will be possible to
interactively enable/disable/reload plugins from Telegram.

## Developing new plugins

Plugins have their own directory in `plugins` and at least an executable file
`plugins/my_plugin/my_plugin.js`. They can optionally have a `config.json`
and/or an NPM `package.json` in the same directory. For now, reference the
annotated `plugins/echo` as an example plugin (although this is not the only
possible style for writing plugins). Your plugin can have its own dependencies, 
submodules and data files if necessary.

## Logging

Logging is realized with `log4js` and defaults to dumping all messages except
debug information to standard output and daily rotating files. Logging behavior
can be customized in your local configuration file. Refer to the [log4js 
documentation][1] for further details.

[1]: https://github.com/nomiddlename/log4js-node#configuration
