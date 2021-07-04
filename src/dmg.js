/* global CPU, MMU, PPU, LCDScreen, Console */
/* global CYCLES_PER_FRAME */
"use strict"

class DMG {
  constructor(cpu, ppu, mmu, screen, cons) {
    this.cpu = cpu;
    this.ppu = ppu;
    this.mmu = mmu;
    this.screen = screen;
    this.cycles_per_frame = CYCLES_PER_FRAME;
    this.console = cons;
  }

  reset() {
    this.cycles = 0;
    this.frames = 0;
    this.cpu.reset();
    this.ppu.reset();
    this.mmu.reset();
  }

  loadRom(rom) {
    this.mmu.loadRom(rom);
  }

  start() {
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
