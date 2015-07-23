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
    if (this._once !== undefined) {
        product.one_time_keyboard = this._once;
    }
    if (this._selective !== undefined) {
        product.selective = this._selective;
    }
    if (this._resize !== undefined) {
        product.resize_keyboard = this._resize;
    }
    product.keyboard = _.isArray(this._choices) ?
        _.chunk(this._choices, this._columns) : [];
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

module.exports = {
    KeyboardBuilder: KeyboardBuilder,
    HideKeyboardBuilder: HideKeyboardBuilder
};
