/* global JOYP_REG, JOYP_P14, JOYP_P15 */
"use strict";

// Mapping for button -> type/value
const JOYP_BUTTONS = {
  "up"      : [0, 4],
  "down"    : [0, 8],
  "left"    : [0, 2],
  "right"   : [0, 1],
  "b"       : [1, 2],
  "a"       : [1, 1],
  "select"  : [1, 4],
  "start"   : [1, 8],
}

// Joypad Controller
class Joypad {
  constructor() {
    // store dpad and action button values in array
    // 0xf = no buttons pressed
    this.buttons = [0xf, 0xf];
    this.select = 0; // Used to switch between dpad/action buttons
  }

  // Register a button event (0 = pressed)
  buttonPressed(button, state) {
    let [sel, bit] = JOYP_BUTTONS[button];
    this.buttons[sel] = state ? (this.buttons[sel] & ~bit) : (this.buttons[sel] | bit);
    console.info("joypad event: name=" + button + " select=" + sel + " state=" + state + " buttons=" + this.buttons);
  }

  // Switch between reading directional/action buttons
  // or reset both by writing JOYP_15 | JOYP_P14
  write(value) {
    if (value === (JOYP_P15 | JOYP_P14)) {
      this.buttons = [0xf, 0xf];
    }
    else if (value === JOYP_P14) {
      this.select = 1; // P14 high = action buttons selected
    }
    else if (value === JOYP_P15) {
      this.select = 0; // P15 high = dpad selected
    }
    else {
      console.error("Joypad write error: " + value);
    }
  }
  // Get current button status for dpad or action buttons
  read() {
    return this.buttons[this.select];
  }
}
