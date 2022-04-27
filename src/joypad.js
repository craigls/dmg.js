// Joypad Controller
class Joypad {
  constructor(mmu) {
    // store dpad and action button values in array
    // 0xf = no buttons pressed
    this.buttons = [0xf, 0xf];
    this.select = 0; // Used to switch between dpad/action buttons
    this.mmu = mmu;
  }

  // Register a button event (0 = pressed)
  buttonPressed(button, state) {
    let [sel, bit] = Constants.JOYP_BUTTONS[button];
    this.buttons[sel] = state ? (this.buttons[sel] & ~bit) : (this.buttons[sel] | bit);
    //console.info("joypad event: name=" + button + " select=" + sel + " state=" + state + " buttons=" + this.buttons);

    // Request joypad interrupt on button press (state = true)
    let ifreg = this.mmu.readByte(Constants.IF_REG);
    if (state) {
      this.mmu.writeByte(Constants.IF_REG, ifreg | Constants.IF_JOYPAD);
    }
    else {
      this.mmu.writeByte(Constants.IF_REG, ifreg & ~Constants.IF_JOYPAD);
    }
  }

  // Switch between reading directional/action buttons
  // or reset both by writing JOYP_15 | JOYP_P14
  write(value) {
    if (value === (Constants.JOYP_P15 | Constants.JOYP_P14)) {
      // TODO: It's not clear to me how the joypad reset should work
      //this.buttons = [0xf, 0xf];
    }
    else if (value === Constants.JOYP_P14) {
      this.select = 1; // P14 high = action buttons selected
    }
    else if (value === Constants.JOYP_P15) {
      this.select = 0; // P15 high = dpad selected
    }
    else {
      //console.error("Joypad write error: " + value);
    }
  }
  // Get current button status for dpad or action buttons
  read() {
    return this.buttons[this.select];
  }
}
