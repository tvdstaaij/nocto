var _ = require('lodash');
var emojiData = require('emoji-data');
var emojiRegex = require('emoji-regex');

// http://unicode.org/reports/tr51/#Subject_Emoji_Modifiers
var skinVariantCandidates = [
    '1F466','1F467','1F468','1F469','1F474','1F475','1F476','1F471','1F46E',
    '1F472','1F473','1F477','1F478','1F482','1F385','1F47C','1F486','1F487',
    '1F470', '1F64D','1F64E','1F645','1F646','1F481','1F64B','1F647','1F600',
    '1F601','1F602', '1F603','1F604','1F605','1F606','1F609','1F60A','1F60B',
    '1F60E','1F60D','1F618', '1F617','1F619','1F61A','263A','1F642','1F917',
    '1F607','1F914','1F610','1F611', '1F636','1F644','1F60F','1F623','1F625',
    '1F62E','1F910','1F62F','1F62A','1F62B', '1F634','1F60C','1F913','1F61B',
    '1F61C','1F61D','2639','1F641','1F612','1F613', '1F614','1F615','1F616',
    '1F643','1F637','1F912','1F915','1F911','1F632','1F61E', '1F61F','1F624',
    '1F622','1F62D','1F626','1F627','1F628','1F629','1F62C','1F630', '1F631',
    '1F633','1F635','1F621','1F620','1F47F','1F608','1F64C','1F64F','1F6B6',
    '1F3C3','1F483','1F4AA','1F448','1F449','261D','1F446','1F595','1F447',
    '270C', '1F596','1F918','1F590','270A','270B','1F44A','1F44C','1F44D',
    '1F44E','1F44B', '1F44F','1F450','270D','1F485','1F442','1F443','1F6A3',
    '1F6C0','1F3C2','1F3C4','1F3C7','1F3CA','1F6B4','1F6B5'
];
var skinVariantModifiers = [
    "\uD83C\uDFFB", // U+1F3FB EMOJI MODIFIER FITZPATRICK TYPE-1-2
    "\uD83C\uDFFB", // U+1F3FB EMOJI MODIFIER FITZPATRICK TYPE-1-2
    "\uD83C\uDFFC", // U+1F3FC EMOJI MODIFIER FITZPATRICK TYPE-3
    "\uD83C\uDFFD", // U+1F3FD EMOJI MODIFIER FITZPATRICK TYPE-4
    "\uD83C\uDFFE", // U+1F3FE EMOJI MODIFIER FITZPATRICK TYPE-5
    "\uD83C\uDFFF"  // U+1F3FF EMOJI MODIFIER FITZPATRICK TYPE-6
];

function isSkinVariantCandidate(emoji) {
    var char = emojiData.scan(emoji);
    return (
        char && char.length === 1 &&
        skinVariantCandidates.indexOf(char[0].unified.toUpperCase()) !== -1
    );
}

var properties = {data: emojiData, regex: emojiRegex};
var methods = {};

// Translation from and to :short_names: (http://emoji-cheat-sheet.com/)
methods.namesToUnicode = function(text) {
    return text.replace(/:([a-z0-9_+\-]+):/ig, function(match, shortName) {
        var char = emojiData.from_short_name(shortName);
        if (char) {
            return char.render();
        }
        return match;
    });
};
methods.unicodeToNames = function(text) {
    return text.replace(emojiRegex(), function(match) {
        var char = emojiData.scan(match);
        if (char && char.length === 1) {
            return ':' + char[0].short_name + ':';
        }
        return match;
    });
};

// Replace all eligible unicode emoji with Unicode 8.0 skin tone variants
// Variant is Fitzpatrick scale number (1-6)
methods.forceSkinVariant = function(text, variant) {
    var variantCodepoint = skinVariantModifiers[variant - 1];
    if (!variantCodepoint) {
        return text;
    }
    return text.replace(emojiRegex(), function(match) {
        if (isSkinVariantCandidate(match)) {
            return match + variantCodepoint;
        }
        return match;
    });
};

// Replace eligible unicode emoji with a skin tone variant based on a suffix
// emoji#3 will become the variant of emoji with Fitzpatrick number 3
methods.applySkinVariants = function(text) {
    var emojiMatch = null, emojiPositions = {};
    var regex = emojiRegex();
    while ((emojiMatch = regex.exec(text)) !== null) {
        emojiPositions[emojiMatch.index] = emojiMatch[0].length;
    }
    return text.replace(/#([1-6])/g, function(match, variant, matchOffset) {
        var emojiLength = null;
        for (var i = 1; i <= 2; i++) {
            var precedingEmoji = emojiPositions[matchOffset - i];
            if (precedingEmoji === i) {
                emojiLength = i;
                break;
            }
        }
        if (emojiLength !== null) {
            var emojiOffset = matchOffset - emojiLength;
            if (isSkinVariantCandidate(text.substr(emojiOffset, emojiLength))) {
                return skinVariantModifiers[variant - 1];
            }
        }
        return match;
    });
};

methods.fromBoolean = function(bool) {
    return emojiData.from_short_name(
        bool ? 'heavy_check_mark' : 'x'
    ).render();
};

module.exports.provides = function() {
    return _.extend(properties, methods);
};
