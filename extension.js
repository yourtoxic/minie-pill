import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Controller} from './lib/controller.js';

export default class MiniePillExtension extends Extension {
    enable() {
        this._controller = new Controller(this);
        this._controller.enable();
    }

    disable() {
        this._controller?.disable();
        this._controller = null;
    }
}
