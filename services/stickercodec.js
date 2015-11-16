var _ = require('lodash');
var config = require('config');
var Promise = require('bluebird');
var botUtil = require('../lib/utilities.js');

var cwebp = botUtil.optionalRequire('cwebp');
var Imagemin = botUtil.optionalRequire('imagemin');
if (Imagemin) {
    Promise.promisifyAll(Imagemin.prototype);
}

var svcConfig = _.get(config, 'services.config.stickercodec') || {};
var methods = {};

methods.decode = function(input) {
    var decoder = new cwebp.DWebp(input);
    return Promise.resolve(decoder.toBuffer());
};

methods.encode = function(input) {
    var encoder = new cwebp.CWebp(input);
    return Promise.resolve(encoder.toBuffer());
};

methods.optimizeDecoded = function(input) {
    return new Imagemin()
        .src(input)
        .use(Imagemin.optipng({
            optimizationLevel: svcConfig.optimizationLevel
        }))
        .runAsync()
        .spread(function(result) {
            return result;
        });
};

module.exports.provides = _.constant(methods);
