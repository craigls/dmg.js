/* global OAM_DMA_REG, JOYP_REG, JOYP_P14, JOYP_P15, DIV_REG */
/*
 * Memory Map
 * Taken from https://gbdev.io/pandocs
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
"use strict"

class MMU {
  constructor(joypad) {
    this.header = {};
    this.rom1 = null;
    this.rom2 = null;
    this.ram = null;
    this.hram = null;
    this.vram = null;
    this.xram = null;
    this.wram = null;
    this.oam = null;
    this.io = null
    this.ie = null;
    this.joypad = joypad;
  }

  reset() {
    this.header = {};
    this.ram = new Uint8Array(32 * 1024);
    this.vram = new Uint8Array(8 * 1024);
    this.xram = new Uint8Array(8 * 1024);
    this.wram = new Uint8Array(8 * 1024);
    this.hram = new Uint8Array(128);
    this.oam = new Uint8Array(128);
    this.io = new Uint8Array(128);
    this.ie = 0;
  }

  loadRom(rom) {
    this.header = this.readHeader(rom);
    this.rom1 = new Uint8Array(rom.slice(0, 16 * 1024));
    this.rom2 = new Uint8Array(rom.slice(16 * 1024));
    this.bank = [0, 0];
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
    }
  }

  readByte(loc) {
    // Route to joypad
    if (loc == JOYP_REG) {
      return this.joypad.read();
    }

    // ROM 1
    else if (loc >= 0x0000 && loc <= 0x3fff) {
      return this.rom1[loc];
    }

    // ROM 2
    else if (loc >= 0x4000 && loc <= 0x7fff) {
      return this.rom2[loc - 0x4000];
    }

    // Video RAM
    else if (loc >= 0x8000 && loc <= 0x9fff) {
      return this.vram[loc - 0x8000];
    }

    // Ext. RAM
    else if (loc >= 0xa000 && loc <= 0xbfff) {
      return this.xram[loc - 0xa000];
    }

    // IO registers
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
      console.warn("Invalid memory address: " + loc);
    }
  }

  OAMDMATransfer(value) {
    let src = value << 8;
    let dst = 0xfe00;
    for (var n = 0; n < 160; n++) {
      if (dst < 0x8000) {
        throw new Error("Invalid address for DMA transfer: " + dst);
      }
      this.writeByte(dst + n, this.readByte(src + n));
    }
  }

  writeByte(loc, value) {
    let cycles = 0;

    // Selects joypad buttons to read from (dpad or action button)
    if (loc == JOYP_REG) {
      this.joypad.write(value);
    }

    // Reset DIV register
    else if (loc == DIV_REG) {
      this.io[DIV_REG - 0xff00] = 0; // writing any value to DIV resets to zero
    }

    // DMA Transfer
    else if (loc == OAM_DMA_REG) {
      this.OAMDMATransfer(value);
      cycles = 160; // DMA Transfer takes 160 cycles
    }

    // ROM
    else if (loc >= 0x0000 && loc <= 0x7fff) {
      // read only
    }


    // Video RAM
    else if (loc >= 0x8000 && loc <= 0x9fff) {
      this.vram[loc - 0x8000] = value;
    }

    // Ext. RAM
    else if (loc >= 0xa000 && loc <= 0xbfff) {
      this.xram[loc - 0xa000] = value;
    }

    // IO registers
    else if (loc >= 0xff00 && loc <= 0xff7f) {
      this.io[loc - 0xff00] = value;
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

    // Work RAM
    else if (loc >= 0xc000 && loc <= 0xdfff) {
      this.wram[loc - 0xc000] = value;
    }

    else {
      //console.warn("Invalid memory address: " + loc);
    }
    return cycles;
  }
}
