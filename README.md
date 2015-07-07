# nocto.js

Nocto is a Node.js Telegram bot application with an asynchronous plugin-based
architecture, using the official bot API. It relies on long polling to be
rapidly notified of new messages.

This project is under heavy development; consider it a buggy alpha version.

## Quickstart

1. Resolve core bot dependencies with `npm install`.
2. Resolve dependencies for any plugins you wish to use (`npm install` in their
   directory under `plugins`).
2. Create a `config/local.json`, overriding values from `config/default.json`
   where desired. Specifying `api.token` is required. Note that only the `echo`
   plugin is loaded and enabled by default.
3. Make sure the user running the bot has read/write permission for the
   directories `logs` and `persist`, unless you disable these features.
4. Launch with `node nocto.js` or `npm start`.

## Available plugins

* `echo`: Simple example plugin implementing an `/echo <message>` command.
* `ircbridge`: Allows you to link IRC channels and Telegram groups, relaying
  messages and events in one or both directions. Supports multiple IRC servers
  and bridge routes.

Currently, the only way to enable plugins is to add them to the `autoEnabled`
list in the bot configuration. In the future it will be possible to
interactively enable/disable/reload plugins from Telegram.

## Developing new plugins

Plugins have their own directory in `plugins` and at least an executable file
`plugins/my_plugin/my_plugin.js`. They can optionally have a `config.json`
and/or an NPM `package.json` in the same directory. For now, reference the
annotated `plugins/echo` as an example plugin (although this is not the only
possible style for writing plugins). Your plugin can have its own dependencies
and submodules if necessary.

## Logging

Logging is realized with `log4js` and defaults to dumping all messages except
debug information to standard output and daily rotating files. Logging behavior
can be customized in your local configuration file. Refer to the [log4js 
documentation][1] for further details.

[1]: https://github.com/nomiddlename/log4js-node#configuration
