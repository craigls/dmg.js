/* global OAM_DMA_REG, JOYP_REG, JOYP_P14, JOYP_P15 */
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
    this.rom = null;
    this.ram = null;
    this.joypad = joypad;
  }

  reset() {
    this.ram = new Array(0xffff).fill(0);

    // Set default state per https://gbdev.io/pandocs/Power_Up_Sequence.html
    this.writeByte(0xff07, 0x00);
    this.writeByte(0xff10, 0x80);
    this.writeByte(0xff11, 0xbf);
    this.writeByte(0xff12, 0xf3);
    this.writeByte(0xff14, 0xbf);
    this.writeByte(0xff16, 0x3f);
    this.writeByte(0xff17, 0x00);
    this.writeByte(0xff19, 0xbf);
    this.writeByte(0xff1a, 0x7f);
    this.writeByte(0xff1b, 0xff);
    this.writeByte(0xff1c, 0x9f);
    this.writeByte(0xff1e, 0xbf);
    this.writeByte(0xff20, 0xff);
    this.writeByte(0xff21, 0x00);
    this.writeByte(0xff22, 0x00);
    this.writeByte(0xff23, 0xbf);
    this.writeByte(0xff24, 0x77);
    this.writeByte(0xff25, 0xf3);
    this.writeByte(0xff26, 0xf1);
    this.writeByte(0xff40, 0x91);
    this.writeByte(0xff42, 0x00);
    this.writeByte(0xff43, 0x00);
    this.writeByte(0xff45, 0x00);
    this.writeByte(0xff47, 0xfc);
    this.writeByte(0xff48, 0xff);
    this.writeByte(0xff49, 0xff);
    this.writeByte(0xff4a, 0x00);
    this.writeByte(0xff4b, 0x00);
    this.writeByte(0xffff, 0x00);
  }

  loadRom(rom) {
    this.rom = rom;
  }

  write(loc, value) {
    this.resolve(loc)[loc] = value;
  }

  read(loc) {
    return this.resolve(loc);
  }

  readByte(loc) {
    if (loc == JOYP_REG) {
      return this.joypad.read();
    }
    else {
      return this.resolve(loc)[loc];
    }
  }

  OAMDMATransfer(value) {
    let src = value << 8;
    let dst = 0xfe00;
    for (var n = 0; n < 160; n++) {
      if (dst == OAM_DMA_REG) {
        throw new Error("Invalid address for DMA transfer: " + dst);
      }
      this.write(dst + n, this.readByte(src + n));
    }
  }

  writeByte(loc, value) {
    let cycles = 0;

    // Selects joypad buttons to read from (dpad or action button)
    if (loc == JOYP_REG) {
      this.joypad.write(value);
    }

    else if (loc == DIV_REG) {
      // writing any value to DIV resets it to zero
      this.write(DIV_REG, 0);
    }

    else if (loc == OAM_DMA_REG) {
      this.OAMDMATransfer(value);
      cycles = 160; // DMA Transfer takes 160 cycles
    }

    else if (loc >= 0 && loc <= 0x7fff) {
      // read only
    }

    else {
      this.write(loc, value);
    }
    return cycles;
  }

  resolve(loc) {
    if (loc >= 0 && loc <= 0x7fff) {
      return this.rom;
    }
    else if (loc >= 0x8000 && loc <= 0xffff) {
      return this.ram;
    }
    // TODO: Implement the other memory segments
    throw new Error(loc + ' is an invalid memory address');
  }

}
