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

class MMU { 
  constructor() {
    this.rom = null;
    this.ram = null;
  }

  reset() {
    this.ram = new Array(0x9fff).fill(0);
  }
    
  loadRom(rom) {
    this.rom = rom;
  }

  resolve(loc) {
    // ROM
    if (loc >= 0 && loc <= 0x7fff) {
      return this.rom;
    }
    // RAM
    else if (loc >= 0x8000 && loc <= 0xffff) {
      return this.ram;
    }
    // Hardware IO registers
    else if (loc >= 0xff00 && loc <= 0xff7f) {
      return this.ram;
    }
    // TODO: Implement the other memory segments
    throw new Error(loc + ' is an invalid memory address');
  }

  readByte(loc) {
    if (loc == JOYP_REG) {
      return 0xf;
    }
    return this.resolve(loc)[loc];
  }

  DMATransfer(value) {
    let src = value << 8;
    let dst = 0xfe00;
    let end = dst + 0x9f;

    while (dst <= end) {
      this.resolve(dst)[dst] = src;
      src++;
      dst++;
    }
  }

  writeByte(loc, value) {
    let cycles = 0;
    if (loc == OAM_DMA_REG) {
      this.DMATransfer(value);
      cycles = 160; // DMA Transfer takes 160 cycles
    }
    else if (loc == JOYP_REG) {
      return;
    }
    else if (loc >= 0 && loc <= 0x7fff) {
      console.log(loc + " is read only");
      return;
    }
    this.resolve(loc)[loc] = value;
    return cycles;
  }
}
