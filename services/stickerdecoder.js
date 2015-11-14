var _ = require('lodash');
var Promise = require('bluebird');
var botUtil = require('../lib/utilities.js');

var cwebp = botUtil.optionalRequire('cwebp');
var Imagemin = botUtil.optionalRequire('imagemin');
if (Imagemin) {
    Promise.promisifyAll(Imagemin.prototype);
}

var methods = {};

methods.decode = function(input) {
    var decoder = new cwebp.DWebp(input);
    return Promise.resolve(decoder.toBuffer());
};

methods.optimize = function(input) {
    return new Imagemin()
        .src(input)
        .use(Imagemin.optipng())
        .runAsync()
        .spread(function(result) {
            return result;
        });
};

module.exports.provides = _.constant(methods);
