// Joypad Controller
class Joypad {
  static JOYP_P15 = 0x20; // Bit for b, a, select, start buttons (0 = select)
  static JOYP_P14 = 0x10; // Bit for up, down, left, right (0 = select)

  // Mapping for button -> type/value
  static JOYP_BUTTONS = {
    "up"      : [0, 4],
    "down"    : [0, 8],
    "left"    : [0, 2],
    "right"   : [0, 1],
    "b"       : [1, 2],
    "a"       : [1, 1],
    "select"  : [1, 4],
    "start"   : [1, 8],
  }

  constructor(dmg) {
    // store dpad and action button values in array
    // 0xf = no buttons pressed
    this.dmg = dmg;
    this.buttons = [0xf, 0xf];
    this.select = 0; // Used to switch between dpad/action buttons
  }

  reset() {
    this.mmu = this.dmg.mmu;
  }

  // Register a button event (0 = pressed)
  buttonPressed(button, state) {
    const [sel, bit] = Joypad.JOYP_BUTTONS[button];
    this.buttons[sel] = state ? (this.buttons[sel] & ~bit) : (this.buttons[sel] | bit);
    //console.info("joypad event: name=" + button + " select=" + sel + " state=" + state + " buttons=" + this.buttons);

    // Request joypad interrupt on button press (state = true)
    const ifreg = this.mmu.readByte(CPU.IF_REG);
    if (state) {
      this.mmu.writeByte(CPU.IF_REG, ifreg | CPU.IF_JOYPAD);
    }
    else {
      this.mmu.writeByte(CPU.IF_REG, ifreg & ~CPU.IF_JOYPAD);
    }
  }

  // Switch between reading directional/action buttons
  // or reset both by writing JOYP_15 | JOYP_P14
  write(value) {
    if (value === (Joypad.JOYP_P15 | Joypad.JOYP_P14)) {
      // TODO: It's not clear to me how the joypad reset should work
      //this.buttons = [0xf, 0xf];
    }
    else if (value === Joypad.JOYP_P14) {
      this.select = 1; // P14 high = action buttons selected
    }
    else if (value === Joypad.JOYP_P15) {
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
window.Joypad = Joypad;
