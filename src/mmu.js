// MMU
class MMU {
  /*
   * Memory Map: (source: https://gbdev.io/pandocs)
   *
   * 0x0000 0x3fff: 16 KiB ROM bank 00 From cartridge, usually a fixed bank
   * 0x4000 0x7fff: 16 KiB ROM Bank 01~NN From cartridge, switchable bank via mapper (if any)
   * 0x8000 0x9fff: 8 KiB Video RAM (VRAM) In CGB mode, switchable bank 0/1
   * 0xa000 0xbfff: 8 KiB External RAM From cartridge, switchable bank if any
   * 0xc000 0xcfff: 4 KiB Work RAM (WRAM)
   * 0xd000 0xdfff: 4 KiB Work RAM (WRAM) In CGB mode, switchable bank 1~7
   * 0xe000 0xfdff: Mirror of C000~DDFF (ECHO RAM) Nintendo says use of this area is prohibited.
   * 0xfe00 0xfe9f: Sprite attribute table (OAM)
   * 0xfea0 0xfeff: Not Usable Nintendo says use of this area is prohibited
   * 0xff00 0xff7f: I/O Registers
   * 0xff80 0xfffe: High RAM (HRAM)
   * 0xffff 0xffff: Interrupts Enable Register (IE)
   *
   */

  // Joypad register
  static JOYP_REG = 0xff00;

  constructor(dmg) {
    this.dmg = dmg;
    this.rom1 = null;
    this.rom2 = null;
    this.ram = null;
    this.hram = null;
    this.vram = null;
    this.xram = null;
    this.wram = null;
    this.oam = null;
    this.io = null;
    this.ie = null;
    this.mbcType = null;
    this.bankNum1 = null;
    this.bankNum2 = null;
    this.bankMode = null;
    this.xramEnabled = false;
  }

  reset() {
    this.apu = this.dmg.apu;
    this.joypad = this.dmg.joypad;
    this.ram = new Uint8Array(32 * 1024);
    this.vram = new Uint8Array(8 * 1024);
    this.xram = new Uint8Array(8 * 1024);
    this.wram = new Uint8Array(8 * 1024);
    this.hram = new Uint8Array(128);
    this.oam = new Uint8Array(160);
    this.io = new Uint8Array(128);
    this.ie = 0;
    this.mbcType = 0;
    this.bankNum1 = 1;
    this.bankNum2 = 0;
    this.bankMode = 0;
    this.xramEnabled = false;
  }

  loadRom(rom) {
    const header = this.readHeader(rom);
    this.mbcType = header.mbcType;
    this.rom1 = new Uint8Array(rom.slice(0, 16 * 1024));
    this.rom2 = new Uint8Array(rom.slice(16 * 1024));
  }

  readHeader(rom) {
    return {
      title: getText(rom.slice(0x0134, 0x0144)),
      mfr: getText(rom.slice(0x013f, 0x0143)),
      cgb: rom[0x0143],
      newLicense: rom.slice(0x0144, 0x0146),
      sgb: rom[0x0146],
      mbcType: rom[0x0147],
      romSize: rom[0x0148],
      ramSize: rom[0x0148],
      dest: rom[0x014a],
      license: rom[0x014b],
      ver: rom[0x014c],
      checksum1: rom[0x014d],
      checksum2: rom.slice(0x014e, 0x0150),
    };
  }

  readByte(loc) {
    // ROM 1
    if (loc >= 0x0000 && loc <= 0x3fff) {
      return this.rom1[loc];
    }

    // ROM 2
    else if (loc >= 0x4000 && loc <= 0x7fff) {
      // Memory bank switching is a work in progress!
      if (this.mbcType) {
        return this.rom2[(loc - 0x4000) + (16384 * ((this.bankNum2 << 5) + this.bankNum1 - 1))];
      }
      else {
        return this.rom2[loc - 0x4000];
      }
    }

    // Video RAM
    else if (loc >= 0x8000 && loc <= 0x9fff) {
      return this.vram[loc - 0x8000];
    }

    // Ext. RAM
    else if (loc >= 0xa000 && loc <= 0xbfff) {
      if (this.xramEnabled) {
        return this.xram[loc - 0xa000];
      }
    }

    // IO registers
    else if (loc == MMU.JOYP_REG) {
      return this.joypad.read();
    }

    else if (loc >= 0xff00 && loc <= 0xff7f) {
      return this.io[loc - 0xff00];
    }

    // High RAM
    else if (loc >= 0xff80 && loc <= 0xfffe) {
      return this.hram[loc - 0xff80];
    }

    // IE register
    else if (loc === 0xffff) {
      return this.ie;
    }

    // Sprite OAM
    else if (loc >= 0xfe00 && loc <= 0xfe9f) {
      return this.oam[loc - 0xfe00];
    }

    // Work RAM
    else if (loc >= 0xc000 && loc <= 0xdfff) {
      return this.wram[loc - 0xc000];
    }

    else {
      // console.warn("Invalid memory address: " + loc);
    }
  }

  writeByte(loc, value) {
    // Note: Ordering of if/else blocks matters here

    // IO registers
    if (loc == MMU.JOYP_REG) {
      this.joypad.write(value);
    }
    else if (loc >= 0xff00 && loc <= 0xff7f) {
      // Route to APU channels
      if (loc >= APU.rNR10 && loc <= APU.rNR44) {
        this.apu.writeByte(loc, value);
      }
      else {
        this.io[loc - 0xff00] = value;
      }
    }

    // Sprite OAM
    else if (loc >= 0xfe00 && loc <= 0xfe9f) {
      this.oam[loc - 0xfe00] = value;
    }

    // High RAM
    else if (loc >= 0xff80 && loc <= 0xfffe) {
      this.hram[loc - 0xff80] = value;
    }

    // IE register
    else if (loc === 0xffff) {
      this.ie = value;
    }

    // Video RAM
    else if (loc >= 0x8000 && loc <= 0x9fff) {
      this.vram[loc - 0x8000] = value;
    }

    // Ext. RAM
    else if (loc >= 0xa000 && loc <= 0xbfff) {
      if (this.xramEnabled) {
        this.xram[loc - 0xa000] = value;
      }
    }

    // Work RAM
    else if (loc >= 0xc000 && loc <= 0xdfff) {
      this.wram[loc - 0xc000] = value;
    }

    // Memory bank switching is a work in progress!
    else if (this.mbcType) {
      // MBC1: 0000-1FFF - RAM Enable
      if (loc >= 0x0000 && loc <= 0x1fff) {
        this.xramEnabled = (value & 0xa) ? true : false;
      }
      // MBC1: 2000-3FFF - ROM Bank Number
      else if (loc >= 0x2000 && loc <= 0x3fff) {
        this.bankNum1 = (value & 0x1f); // bank 0 invalid - should set to 1 instead
      }
      // MBC1: 4000-5FFF - RAM Bank Number or Upper Bits of ROM Bank Number
      else if (loc >= 0x4000 && loc <= 0x5fff) {
        this.bankNum2 = value & 0xb11;
      }
      // MBC1: 6000-7FFF - Banking Mode Select
      else if (loc >= 0x6000 && loc <= 0x7fff) {
        this.bankMode = value & 1;
      }
    }

    else if (loc >= 0x0000 && loc <= 0x7fff) {
      // read only
    }

    else {
      //console.warn("Invalid memory address: " + loc);
    }
  }

  OAMDMATransfer(value) {
    const src = value << 8;
    for (let n = 0; n < 160; n++) {
      this.oam[n] = this.readByte(src + n);
    }
  }
}
