var _ = require('lodash');
var child_process = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var RUN_ARG = '--runwizard';

if (_.contains(process.argv, RUN_ARG)) {
    runWizard();
}

module.exports.isConfigCustomized = function() {
    var configDir = path.join(__dirname, 'config');
    return _.some(fs.readdirSync(configDir), function(filename) {
        filename = filename.toLowerCase();
        return (
            !_.startsWith(filename, 'default') && _.endsWith(filename, '.json')
        );
    });
};

module.exports.exec = function() {
    var wizardProc = child_process.spawnSync(
        process.execPath, [__filename, RUN_ARG],
        {
            stdio: [process.stdin, process.stdout, process.stderr]
        }
    );
    return (wizardProc.status === 0);
};

function runWizard() {
    var inquirer = require('inquirer');
    console.log('This setup wizard will generate a basic config/local.json ' +
                'based on your answers.');
    inquirer.prompt([
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
    ], function(answers) {
        var config = {
            api: {
                token: answers.apiToken
            },
            plugins: {}
        };
        if (answers.autoLoadPlugins) {
            config.plugins.loadAll = true;
        } else {
            config.plugins.register = [];
            config.plugins.autoEnabled = [];
            console.log('Note: you should specify which plugins to load and ' +
                        'enable in the plugins.register and ' +
                        'plugins.autoEnable arrays.');
        }
        console.log(os.EOL + 'Writing config file...' + os.EOL);
        fs.writeFileSync(
            path.join(__dirname, 'config', 'local.json'),
            JSON.stringify(config, null, 4),
            {
                mode: 0644
            }
        );
    });
}
