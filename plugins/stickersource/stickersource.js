var _ = require('lodash');
var botUtil = require('../../lib/utilities.js');

var handlers = {};
var api, log, fileInfoCache, stickerCodec;

module.exports = function loadPlugin(resources, service) {
    api = resources.api;
    log = resources.log;
    fileInfoCache = service('fileinfocache');
    stickerCodec = service('stickercodec');
    return handlers;
};

handlers.handleMessage = function(message, meta) {
    if (!meta.fresh) return;
    var uploader = _.partial(uploadResult, message.chat.id);
    if (message.sticker) {
        convertSticker(message, _.partial(uploader, 'document', 'png'));
    }
    if (message.photo || message.document) {
        convertImage(message, _.partial(uploader, 'sticker', 'webp'));
    }
};

function convertSticker(message, uploader) {
    var fileId = message.sticker.file_id;
    return fileInfoCache.resolve(fileId)
        .then(function(fileInfo) {
            return stickerCodec.decode(api.requestFile(fileInfo)());
        })
        .bind({})
        .then(function(buffer) {
            this.origSize = buffer.length;
            return stickerCodec.optimizeDecoded(buffer);
        })
        .then(function(result) {
            var buffer = result.contents;
            var ratio = (buffer.length || 0) / (this.origSize || 1);
            log.trace('Serving sticker ' + fileId +
                ' with optimization ratio ' + ratio.toFixed(3));
            return uploader(buffer);
        })
        .catch(function(error) {
            new api.MessageBuilder(message.chat.id)
                .text('Failed to convert sticker, details have been logged.')
                .send();
            log.error(error);
        });
}

function convertImage(message, uploader) {
    var media = botUtil.extractMediaObject(message).object;
    if (_.isArray(media)) {
        media = _.last(media);
    }
    var fileId = media.file_id;
    return fileInfoCache.resolve(fileId)
        .then(function(fileInfo) {
            return stickerCodec.encode(api.requestFile(fileInfo)());
        })
        .then(uploader)
        .catch(function(error) {
            new api.MessageBuilder(message.chat.id)
                .text('Failed to convert image, details have been logged.')
                .send();
            log.error(error);
        });
}

function uploadResult(chatId, mediaType, fileType, buffer) {
    var response = {chat_id: chatId};
    response[mediaType] = {
        value: buffer,
        options: {
            contentType: 'image/' + fileType,
            filename: 'sticker.' + fileType
        }
    };
    return api['send' + _.capitalize(mediaType)]
        .call(api, response, {fileUpload: true});
}
