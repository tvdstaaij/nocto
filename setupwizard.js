var _ = require('lodash');
var child_process = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var RUN_ARG = '--runwizard';
var SPAWN_ARG = '--spawned';

function isConfigCustomized() {
    if (process.env.NODE_CONFIG || process.env.NODE_CONFIG_DIR) {
      return true;
    }
    var configDir = path.join(__dirname, 'config');
    return _.some(fs.readdirSync(configDir), function(filename) {
        filename = filename.toLowerCase();
        return (
            !_.startsWith(filename, 'default') && _.endsWith(filename, '.json')
        );
    });
}

function executeSelf() {
    var wizardProc = child_process.spawnSync(
        process.execPath, [__filename, RUN_ARG, SPAWN_ARG],
        {
            stdio: [process.stdin, process.stdout, process.stderr]
        }
    );
    return (wizardProc.status === 0);
}

function runWizard() {
    var inquirer = require('inquirer');
    var Promise = require('bluebird');

    function promptAsync(questions) {
        return new Promise(function(resolve) {
            return inquirer.prompt(questions, function(answers) {
                return resolve(answers);
            });
        });
    }

    function abort() {
        console.log(os.EOL + 'Aborting.');
        process.exit(3);
    }

    console.log('This wizard will generate a basic config/local.json based ' +
                'on your answers.' + os.EOL);
    var config = {
        api: {},
        plugins: {},
        services: {
            config: {
                firewall: {}
            }
        }
    };
    Promise.try(function() {
        if (isConfigCustomized()) {
            console.log('WARNING: Local configuration detected; ' +
                        'config/local.json will be overwritten.' + os.EOL);
            return promptAsync([
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Proceed anyway?',
                    default: false
                }
            ]);
        }
    }).then(function(answers) {
        if (answers && answers.proceed !== true) {
            abort();
        }
        return promptAsync([
            {
                name: 'apiToken',
                message: 'Telegram bot API token:',
                validate: function(v) { return v.length > 0; }
            },
            {
                type: 'confirm',
                name: 'autoLoadPlugins',
                message: 'Auto-detect available plugins?',
                default: true
            }
        ]);
    }).then(function(answers) {
        config.api.token = answers.apiToken;
        if (!answers.autoLoadPlugins) {
            config.plugins.loadAll = false;
            config.plugins.register = [];
            config.plugins.autoEnabled = [];
            console.log('Note: you should specify which plugins to load and ' +
                        'enable in the plugins.register and ' +
                        'plugins.autoEnable arrays.');
        }

        console.log(os.EOL + 'The following questions will configure the ' +
                    'whitelist-based message firewall.');
        console.log('The default settings won\'t block anything unless a user' +
                    ' is explicitly banned.' + os.EOL);
        var commonRules = [
            {name: '[~] Owner', value: 'owner'},
            {name: '[&] Administrator', value: 'administrator'},
            {name: '[@] Operator', value: 'operator'},
            {name: '[%] Half-operator', value: 'half-operator'},
            {name: '[+] Trusted user', value: 'trusted'}
        ];
        var groupRules = commonRules.concat([
            {name: '[-] User', 'value': 'user'},
            {name: '[b] Blacklisted', 'value': 'blacklisted'}
        ]);
        var privateRules = commonRules.concat([
            {name: '[!] Known (at least one group in common)', value: 'known'},
            {name: '[-] Stranger', 'value': 'user'},
            {name: '[b] Blacklisted', 'value': 'blacklisted'}
        ]);
        return promptAsync([
            {
                type: 'list',
                name: 'groupCommand',
                message: 'Minimum user level to process command in group chat?',
                choices: groupRules,
                default: 'user'
            },
            {
                type: 'list',
                name: 'groupMessage',
                message: 'Minimum user level to process regular message in ' +
                         'group chat?',
                choices: groupRules,
                default: 'blacklisted'
            },
            {
                type: 'list',
                name: 'privateCommand',
                message: 'Minimum user level to process command in ' +
                         'private chat?',
                choices: privateRules,
                default: 'user'
            },
            {
                type: 'list',
                name: 'privateMessage',
                message: 'Minimum user level to process regular private ' +
                         'message?',
                choices: privateRules,
                default: 'user'
            }
        ]);
    }).then(function(answers) {
        config.services.config.firewall.rules = {
            privateCommand: answers.privateCommand,
            groupCommand: answers.groupCommand,
            privateMessage: answers.privateMessage,
            groupMessage: answers.groupMessage
        };

        process.stdout.write(os.EOL);
        console.log('This concludes the setup wizard.' + os.EOL);
        return promptAsync([
            {
                type: 'confirm',
                name: 'writeConfig',
                message: 'Write configuration file with these settings?',
                default: true
            }
        ]);
    }).then(function(answers) {
        if (answers.writeConfig !== true) {
            abort();
        }
        process.stdout.write(os.EOL + 'Writing config file...');
        fs.writeFileSync(
            path.join(__dirname, 'config', 'local.json'),
            JSON.stringify(config, null, 4) + "\n",
            {
                mode: 0644
            }
        );
        process.stdout.write(' done.' + os.EOL);
        if (!_.includes(process.argv, SPAWN_ARG)) {
            process.exit(0);
        } else {
            process.stdout.write(os.EOL);
            return promptAsync([
                {
                    type: 'confirm',
                    name: 'startBot',
                    message: 'Proceed with starting the bot now?',
                    default: true
                }
            ]);
        }
    }).then(function(answers) {
        if (answers.startBot !== true) {
            abort();
        }
    });
}

if (_.includes(process.argv, RUN_ARG)) {
    runWizard();
} else {
    module.exports = {
        isConfigCustomized: isConfigCustomized,
        exec: executeSelf
    };
}
