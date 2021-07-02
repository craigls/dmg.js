/* global CPU, MMU, PPU, LCDScreen, Console */
/* global CYCLES_PER_FRAME */

class DMG {
  constructor(cpu, ppu, mmu, screen, cons) {
    this.cpu = cpu;
    this.ppu = ppu;
    this.mmu = mmu;
    this.screen = screen;
    this.cycles_per_frame = CYCLES_PER_FRAME;
    this.cycles = 0;
    this.frames = 0;
    this.console = cons;
  }

  loadRom(rom) {
    //rom = BOOTROM.concat(TESTROM.slice(0x0100))
    this.mmu.loadRom(rom);
  }
  
  reset() {
    // Reset cycle and frame counts
    this.cycles = 0;
    this.frames = 0;

    // Set register default states per https://gbdev.io/pandocs/Power_Up_Sequence.html
    let mmu = this.mmu;
    let cpu = this.cpu;

    // CPU register defaults
    let AF = 0x01b0;
    let BC = 0x0013;
    let DE = 0x00d8;
    let HL = 0x014d;

    cpu.A = AF >> 8;
    cpu.F = AF & 0xff; 
    cpu.B = BC >> 8;
    cpu.C = BC & 0xff;
    cpu.D = DE >> 8;
    cpu.E = DE & 0xff;
    cpu.H = HL >> 8;
    cpu.L = HL & 0xff;
    cpu.SP = 0xfffe;
    cpu.PC = 0x100; // Skip checksum routines and begin at ROM address 0x100
    //cpu.PC = 0;

    // Everything else
    mmu.writeByte(0xff07, 0x00);
    mmu.writeByte(0xff10, 0x80);
    mmu.writeByte(0xff11, 0xbf);
    mmu.writeByte(0xff12, 0xf3);
    mmu.writeByte(0xff14, 0xbf);
    mmu.writeByte(0xff16, 0x3f);
    mmu.writeByte(0xff17, 0x00);
    mmu.writeByte(0xff19, 0xbf);
    mmu.writeByte(0xff1a, 0x7f);
    mmu.writeByte(0xff1b, 0xff);
    mmu.writeByte(0xff1c, 0x9f);
    mmu.writeByte(0xff1e, 0xbf);
    mmu.writeByte(0xff20, 0xff);
    mmu.writeByte(0xff21, 0x00);
    mmu.writeByte(0xff22, 0x00);
    mmu.writeByte(0xff23, 0xbf);
    mmu.writeByte(0xff24, 0x77);
    mmu.writeByte(0xff25, 0xf3);
    mmu.writeByte(0xff26, 0xf1);
    mmu.writeByte(0xff40, 0x91);
    mmu.writeByte(0xff42, 0x00);
    mmu.writeByte(0xff43, 0x00);
    mmu.writeByte(0xff45, 0x00);
    mmu.writeByte(0xff47, 0xfc);
    mmu.writeByte(0xff48, 0xff);
    mmu.writeByte(0xff49, 0xff);
    mmu.writeByte(0xff4a, 0x00);
    mmu.writeByte(0xff4b, 0x00);
    mmu.writeByte(0xffff, 0x00);
  }

  start() {
    this.mmu.reset();
    this.ppu.reset();
    this.cpu.reset();
    this.reset()

    // Start main emulation loop
    this.update();
  }

  // Thank you http://www.codeslinger.co.uk/pages/projects/gameboy/beginning.html
  nextFrame() {
    let total = 0;
    while (total < this.cycles_per_frame) {
      let cycles = this.cpu.update();
      this.ppu.update(cycles);
      total += cycles;
    }
    this.cycles += total;
    this.screen.update();
    requestAnimationFrame(() => this.nextFrame());
    requestAnimationFrame(() => this.console ? this.console.update(this) : {});
  }

  update() {
    this.nextFrame();
    this.frames++;
  }
}

function createDMG() {
  let screenElem = document.getElementById('screen');
  let consoleElem = document.getElementById('console');
  let mmu = new MMU();
  let ppu = new PPU(mmu);
  let screen = new LCDScreen(screenElem, ppu);
  let cpu = new CPU(mmu, ppu);
  let cons = new Console(consoleElem);
  return new DMG(cpu, ppu, mmu, screen, cons);
}

function loadRomFromFile(file) {
  let reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.onload = function() {
    window.dmg.loadRom(Array.from(new Uint8Array(reader.result)));
    window.dmg.start();
  }
}

window.createDMG = createDMG;
window.loadRomFromFile = loadRomFromFile;
window.onload = () => {
  window.dmg = window.createDMG();
}
