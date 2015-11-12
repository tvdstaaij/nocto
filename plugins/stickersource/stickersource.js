var _ = require('lodash');
var Promise = require('bluebird');
var request = require('request');
var DWebp = require('cwebp').DWebp;
var Imagemin = require('imagemin');
Promise.promisifyAll(Imagemin.prototype);
Promise.promisifyAll(request);

var handlers = {};
var api, log;

module.exports = function loadPlugin(resources, service) {
    api = resources.api;
    log = resources.log;
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    if (!meta.fresh || !message.sticker) return;
    return api.getFile({file_id: message.sticker.file_id})
        .then(function(fileInfo) {
            var stream = request({
                uri: api.getFileUri(fileInfo),
                encoding: null
            });

            var decoder = new DWebp(stream);
            return Promise.resolve(decoder.toBuffer())
                .bind({})
                .then(function(buffer) {
                    this.origSize = buffer.length;
                    return new Imagemin()
                        .src(buffer)
                        .use(Imagemin.optipng())
                        .runAsync();
                })
                .spread(function(result) {
                    var buffer = result.contents;
                    var ratio = (buffer.length || 0) / (this.origSize || 1);
                    log.trace('Optipng compresson ratio ' + ratio);
                    var mode = 'document';
                    var response = {chat_id: message.chat.id};
                    response[mode] = {
                        value: buffer,
                        options: {
                            contentType: 'image/png',
                            filename: 'sticker.png'
                        }
                    };
                    api['send' + _.capitalize(mode)]
                        .call(api, response, {fileUpload: true});
                });
        })
        .bind(log).catch(log.error);
};
