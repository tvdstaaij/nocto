var _ = require('lodash');

function KeyboardBuilder(choices) {
    this._choices = [];
    if (choices) {
        this.choices(choices);
    }
    this._columns = 1;
}
KeyboardBuilder.prototype.choices = function(choices) {
    this._choices = _.toArray(choices);
    return this;
};
KeyboardBuilder.prototype.prefix = function(prefix) {
    this._prefix = prefix;
    return this;
};
KeyboardBuilder.prototype.columns = function(columnCount) {
    this._columns = Number(columnCount);
    return this;
};
KeyboardBuilder.prototype.resize = function(enabled) {
    this._resize = Boolean(enabled);
    return this;
};
KeyboardBuilder.prototype.selective = function(enabled) {
    this._selective = Boolean(enabled);
    return this;
};
KeyboardBuilder.prototype.once = function(enabled) {
    this._once = Boolean(enabled);
    return this;
};
KeyboardBuilder.prototype.build = function() {
    var product = {};
    var choices = _.isArray(this._choices) ? this._choices : [];
    if (this._once !== undefined) {
        product.one_time_keyboard = this._once;
    }
    if (this._selective !== undefined) {
        product.selective = this._selective;
    }
    if (this._resize !== undefined) {
        product.resize_keyboard = this._resize;
    }
    if (this._prefix) {
        choices = choices.map(function(choice) {
            return String(this._prefix).concat(choice);
        }, this);
    }
    product.keyboard = _.chunk(choices, this._columns);
    return product;
};

function HideKeyboardBuilder() {}
HideKeyboardBuilder.prototype.selective = function(enabled) {
    this._selective = Boolean(enabled);
    return this;
};
HideKeyboardBuilder.prototype.build = function() {
    var product = {hide_keyboard: true};
    if (this._selective !== undefined) {
        product.selective = this._selective;
    }
    return product;
};

function MessageBuilder(chatId) {
    if (chatId !== undefined) {
        this.chat(chatId);
    }
}
MessageBuilder.prototype.chat = function(chatId) {
    this._chat = chatId;
    return this;
};
MessageBuilder.prototype.keyboard =
MessageBuilder.prototype.markup = function(markup) {
    this._markup = markup;
    return this;
};
MessageBuilder.prototype.reply = function(messageId) {
    this._reply = messageId;
    return this;
};
MessageBuilder.prototype.photo = function(photo) {
    this._photo = photo;
    return this;
};
MessageBuilder.prototype.sticker = function(sticker) {
    this._sticker = sticker;
    return this;
};
MessageBuilder.prototype.document = function(document) {
    this._document = document;
    return this;
};
MessageBuilder.prototype.video = function(video) {
    this._video = video;
    return this;
};
MessageBuilder.prototype.audio = function(audio) {
    this._audio = audio;
    return this;
};
MessageBuilder.prototype.caption = function(caption) {
    this._caption = caption;
    return this;
};
MessageBuilder.prototype.text = function(text) {
    this._text = text;
    return this;
};
MessageBuilder.prototype.action = function(action) {
    this._action = action;
    return this;
};
MessageBuilder.prototype.location = function(latitude, longitude) {
    this._latitude = latitude;
    this._longitude = longitude;
    return this;
};
MessageBuilder.prototype.forward = function(chatId, messageId) {
    this._message = messageId;
    this._fromChat = chatId;
    return this;
};
MessageBuilder.prototype.webPreview = function(enable) {
    this._webPreview = Boolean(enable);
    return this;
};
MessageBuilder.prototype.build = function() {
    var product = {};
    if (this._chat !== undefined) {
        product.chat_id = this._chat;
    }
    if (this._markup !== undefined) {
        product.reply_markup = this._markup;
    }
    if (this._message !== undefined) {
        product.message_id = this._message;
    }
    if (this._fromChat !== undefined) {
        product.from_chat_id = this._fromChat;
    }
    if (this._latitude !== undefined) {
        product.latitude = this._latitude;
    }
    if (this._longitude !== undefined) {
        product.longitude = this._longitude;
    }
    if (this._text !== undefined) {
        product.text = this._text;
    }
    if (this._photo !== undefined) {
        product.photo = this._photo;
    }
    if (this._video !== undefined) {
        product.video = this._video;
    }
    if (this._audio !== undefined) {
        product.audio = this._audio;
    }
    if (this._document !== undefined) {
        product.document = this._document;
    }
    if (this._sticker !== undefined) {
        product.sticker = this._sticker;
    }
    if (this._reply !== undefined) {
        product.reply_to_message_id = this._reply;
    }
    if (this._caption !== undefined) {
        product.caption_to_message_id = this._caption;
    }
    if (this._action !== undefined) {
        product.action_to_message_id = this._action;
    }
    if (this._webPreview !== undefined) {
        product.disable_web_page_preview = !this._webPreview;
    }
    return product;
};

module.exports = {
    KeyboardBuilder: KeyboardBuilder,
    HideKeyboardBuilder: HideKeyboardBuilder,
    MessageBuilder: MessageBuilder
};
