var _ = require('lodash');
var httpProxy = require('http-proxy');
var url = require('url');

var proxy = httpProxy.createProxyServer();

module.exports.init = function(resources) {
    var api = resources.bot.api;
    var app = resources.web.app;
    var config = resources.config;
    var log = resources.log;

    var proxyOptions = {
        changeOrigin: true,
        agent: resources.bot.agent,
        target: (function() {
            var baseUriComponents = url.parse(config.get('api.baseUri'));
            return baseUriComponents.protocol + '//' + baseUriComponents.host;
        })()
    };

    proxy.on('error', function(err, req, res) {
        res.status = 502;
        res.end('Bad Gateway');
        log.error(err);
    });

    app.get('/media/:id*', function(req, res, next) {
        api.getFile({file_id: req.params.id})
            .then(function(fileInfo) {
                var targetUriComponents = url.parse(api.getFileUri(fileInfo));
                req.url = targetUriComponents.path;
                proxy.web(req, res, proxyOptions);
            })
            .catch(_.ary(next, 0));
    });
};
