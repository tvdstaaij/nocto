var _ = require('lodash');

var handlers = {};
var api, log, fileInfoCache, stickerDecoder;

module.exports = function loadPlugin(resources, service) {
    api = resources.api;
    log = resources.log;
    fileInfoCache = service('fileinfocache');
    stickerDecoder = service('stickerdecoder');
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    if (!meta.fresh || !message.sticker) return;
    var fileId = message.sticker.file_id;
    return fileInfoCache.resolve(fileId)
        .then(function(fileInfo) {
            return stickerDecoder.decode(api.requestFile(fileInfo)());
        })
        .bind({})
        .then(function(buffer) {
            this.origSize = buffer.length;
            return stickerDecoder.optimize(buffer);
        })
        .then(function(result) {
            var buffer = result.contents;
            var ratio = (buffer.length || 0) / (this.origSize || 1);
            log.trace('Serving sticker ' + fileId +
                ' with optimization ratio ' + ratio.toFixed(3));
            var mode = 'document'; // Could also be 'photo'
            var response = {chat_id: message.chat.id};
            response[mode] = {
                value: buffer,
                options: {
                    contentType: 'image/png',
                    filename: 'sticker.png'
                }
            };
            return api['send' + _.capitalize(mode)]
                .call(api, response, {fileUpload: true});
        })
        .catch(function(error) {
            new api.MessageBuilder(message.chat.id)
                .text('Failed to convert sticker, details have been logged.')
                .send();
            log.error(error);
        });
};
