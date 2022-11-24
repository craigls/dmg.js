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
  static JOYP = 0xff00;

  // CGB only - VRAM DMA source (high, low)
  static HDMA1 = 0xff51;
  static HDMA2 = 0xff52;

  // CGB only - VRAM DMA destination (high, low)
  static HDMA3 = 0xff53;
  static HDMA4 = 0xff54;

  // CGB only - VRAM DMA length/mode/start
  static HDMA5 = 0xff55;

  // CGB only - palette registers
  static BCPS_BGPI = 0xff68;
  static BCPD_BGPD = 0xff69;
  static OCPS_OPBI = 0xff6a;
  static OCPD_OBPD = 0xff6b;

  // CGB only - KEY1 speed switch
  static KEY1 = 0xff4d;

  // CGB only - VRAM bank switch
  static VBK = 0xff4f;

  // CGB type
  static CGB_COMPAT = 0x80;
  static CGB_ONLY = 0xc0;

  static MBC0 = 0;
  static MBC1 = 1;
  static MBC5 = 5;

  constructor(dmg) {
    this.dmg = dmg;
    this.rom1 = null;
    this.rom2 = null;
    this.hram = null;
    this.vram = null;
    this.vram1 = null;
    this.vram2 = null;
    this.xram = null;
    this.wram = null;
    this.wramOffset = 0;

    this.oam = null;
    this.io = null;
    this.ie = null;
    this.mbcType = null;
    this.romBankNum1 = null;
    this.romBankNum2 = null;
    this.romBankNum1 = null;
    this.bankMode = null;
    this.xramEnabled = false;
    this.cgbram = null;
  }

  reset() {
    this.apu = this.dmg.apu;
    this.joypad = this.dmg.joypad;
    this.vram1 = new Uint8Array(8 * 1024);
    this.vram2 = new Uint8Array(8 * 1024);
    this.vram = this.vram1;
    this.xram = new Uint8Array(128 * 1024);
    this.wram = new Uint8Array(32 * 1024);
    this.wramOffset = 0;
    this.hram = new Uint8Array(128);
    this.oam = new Uint8Array(160);
    this.io = new Uint8Array(128);
    this.ie = 0;
    this.mbcType = 0;
    this.romBankNum1 = 1;
    this.romBankNum2 = 0;
    this.ramBankNum1 = 0;
    this.bankMode = 0;
    this.xramEnabled = false;
    this.cgbram = new Uint8Array(64);
  }

  loadRom(rom) {
    const header = this.readHeader(rom);

    // 0x014b set to 0x33 indicates new license
    const newLicense = rom[0x014b] === 0x33;

    // Read CGB flag if new license
    if (newLicense) {
      if (header.cgb === MMU.CGB_COMPAT || header.cgb === MMU.CGB_ONLY) {
        this.dmg.cgbMode = true;
      }
    }

    // Set MBC type
    switch (header.mbc) {
      case 0x00:
        this.mbcType = MMU.MBC0;
        break;
      case 0x01:
      case 0x02:
      case 0x03:
        this.mbcType = MMU.MBC1;
        break;
      case 0x19:
      case 0x1a:
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
        this.mbcType = MMU.MBC5;
        break;
      default:
        // HACK: Assume MBC1 for now
        this.mbcType = MMU.MBC1;
        break;
    }
    this.rom1 = new Uint8Array(rom.slice(0, 16 * 1024));
    this.rom2 = new Uint8Array(rom.slice(16 * 1024));
  }

  readHeader(rom) {
    return {
      title: getText(rom.slice(0x0134, 0x0144)),
      mfr: getText(rom.slice(0x013f, 0x0143)),
      cgb: rom[0x0143],
      sgb: rom[0x0146],
      mbc: rom[0x0147],
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
      if (this.mbcType == MMU.MBC1) {
        return this.rom2[(loc - 0x4000) + (16384 * ((this.romBankNum2 << 5) + this.romBankNum1 - 1))];
      }
      else if (this.mbcType == MMU.MBC5) {
        return this.rom2[(loc - 0x4000 - 16384) + (16384 * uint16(this.romBankNum2 & 1, this.romBankNum1))];
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
        return this.xram[(loc - 0xa000) + (16384 * this.ramBankNum1 - 1)];
      }
    }

    // IO registers
    else if (loc == MMU.JOYP) {
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
      if (loc <= 0xcfff) {
        return this.wram[loc - 0xc000];
      }
      else {
        return this.wram[(loc - 0xc000) + this.wramOffset];
      }
    }

    else {
      // console.warn("Invalid memory address: " + loc);
    }
  }

  writeByte(loc, value) {
    // IO registers
    if (loc == MMU.JOYP) {
      this.joypad.write(value);
    }
    else if (loc >= 0xff00 && loc <= 0xff7f) {
      // Route to APU channels
      if (loc >= APU.rNR10 && loc <= APU.rNR44) {
        this.apu.writeByte(loc, value);
      }

      // CGB only - Start VRAM DMA Transfer
      else if (this.cgbjode && loc == MMU.HDMA5) {
        this.VRAMDMATransfer(value);
      }

      else if (this.cgbMode && loc == MMU.SVBK) {
        this.wramOffset = value * 4096;
      }

      else if (this.cgbMode && loc == MMU.VBK) {
        // CGB only - Use VRAM2 bank if bit 0 set;
        if (this.dmg.cgbMode && (value & 0x1)) {
          this.vram = this.vram2;
        }
        else {
          this.vram = this.vram1;
        }
      }

      // Capture writes to BCPD/BGPD
      else if (this.dmg.cgbMode && loc == MMU.BCPD_BGPD) {
        const bits = this.io[MMU.BCPS_BGPI - 0xff00];
        const autoIncrement = bits & (1 << 7) !== 0;
        const index = bits & 0x1f;

        // Write to CGB palette memory at <index> and <index> + 1
        this.cgbram[index] = value & 0x0f;
        this.cgbram[index + 1] = (value & 0xf0) & ~(1 << 7); // bit 7 ignored

        // Add to index if auto increment set
        if (autoIncrement) {
          this.io[MMU.BCPS_BGPI - 0xff00] = (autoIncrement << 7) | (index + 1 & 0x3f);
        }
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

    // Ext. RAM bank number
    else if (loc >= 0x4000 && loc <= 0x5fff) {
      this.ramBankNum1 = value & 0x0f;
    }

    // Video RAM
    else if (loc >= 0x8000 && loc <= 0x9fff) {
      this.vram[loc - 0x8000] = value;
    }

    // Ext. RAM
    else if (loc >= 0xa000 && loc <= 0xbfff) {
      if (this.xramEnabled) {
        this.xram[(loc - 0xa000) + (16384 * this.ramBankNum1 - 1)] = value;
      }
    }

    // Work RAM
    else if (loc >= 0xc000 && loc <= 0xdfff) {
      if (loc <= 0xcfff) {
        this.wram[loc - 0xc000] = value;
      }
      else {
        this.wram[(loc - 0xc000) + this.wramOffset] = value;
      }
    }

    // Memory bank switching is a work in progress!

    // MBC1
    else if (this.mbcType === MMU.MBC1) {
      // MBC1: 0000-1FFF - RAM Enable
      if (loc >= 0x0000 && loc <= 0x1fff) {
        this.xramEnabled = (value & 0xa) ? true : false;
      }
      // MBC1: 2000-3FFF - ROM Bank Number
      else if (loc >= 0x2000 && loc <= 0x3fff) {
        this.romBankNum1 = (value & 0x1f); // bank 0 invalid - should set to 1 instead
      }
      // MBC1: 4000-5FFF - RAM Bank Number or Upper Bits of ROM Bank Number
      else if (loc >= 0x4000 && loc <= 0x5fff) {
        this.romBankNum2 = value & 0xb11;
      }
      // MBC1: 6000-7FFF - Banking Mode Select
      else if (loc >= 0x6000 && loc <= 0x7fff) {
        this.bankMode = value & 1;
      }
    }

    // MBC5
    else if (this.mbcType === MMU.MBC5) {
      // MBC5: 0000-1FFF - RAM Enable
      if (loc >= 0x0000 && loc <= 0x1fff) {
        this.xramEnabled = (value & 0xa) ? true : false;
      }
      // MBC5: 2000-2FFF - 8 least significant bits of ROM bank number (Write Only)
      else if (loc >= 0x2000 && loc <= 0x2fff) {
        this.romBankNum1 = value;
      }

      // MBC5: 9th bit of ROM bank number
      else if (loc >= 0x3000 && loc <= 0x3fff) {
        this.romBankNum2 = value & 0x7f;
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

  VRAMDMATransfer(value) {
    console.log('vramdma transfer');
    const src = uint16(this.readByte(MMU.HDMA1), this.readByte(PPU.HDMA2) & ~0x40) & 0x0f; // ignore lower 4 bits
    const dst = uint16(this.readByte(MMU.HDMA3) & ~0xf0, this.readByte(PPU.HDMA4) & ~0x40); // ignore all but bits 12-4
    const length = value & ~0x80;
    const mode = value & 0x80;
    for (let i = 0; i < length; i++) {
      this.writeByte(dst, this.readByte(src + i));
    }
    // Set status to completed
    this.writeByte(MMU.HDMA5, 0xff);
  }
}
window.MMU = MMU;
