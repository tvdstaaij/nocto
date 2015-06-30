# nocto.js

Nocto is a Node.js Telegram bot application with an asynchronous plugin-based
architecture, using the official bot API. It relies on long polling to be rapidly
notified of new messages.

This project is under heavy development; consider it a buggy alpha version.

## Quickstart

1. Resolve dependencies with `npm install`.
2. Create a `config/local.json`, overriding values from `config/default.json`
   where desired. Specifying `api.token` is required.
3. Launch with `node nocto.js` or `npm start`.

## Plugins

Plugins have their own directory in `plugins` and at least an executable file
`plugins/my_plugin/my_plugin.js`. They can optionally have a `config.json` and/or
an NPM `package.json` in the same directory. For now, reference the annotated
`plugins/echo` as an example plugin.

## Logging

Logging is realized with `log4js` and defaults to dumping all messages except
debug information to standard output and daily rotating files. Logging behavior
can be customized in your local configuration file; see [their documentation][1].

[1]: https://github.com/nomiddlename/log4js-node#configuration
