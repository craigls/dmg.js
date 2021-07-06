/* global CPU, MMU, PPU, LCDScreen, Console, Joypad, CONTROLS */
/* global CYCLES_PER_FRAME */
"use strict"

const CONTROLS = {
  "w": "up",
  "s": "down",
  "a": "left",
  "d": "right",
  "j": "b",
  "k": "a",
  "u": "select",
  "i": "start",
}

class DMG {
  constructor(cpu, ppu, mmu, screen, joypad, cons) {
    this.cpu = cpu;
    this.ppu = ppu;
    this.mmu = mmu;
    this.screen = screen;
    this.joypad = joypad;
    this.console = cons;
    this.cycles_per_frame = CYCLES_PER_FRAME;
    this.started = false;
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
    this.started = true;
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

  keyPressed(key, state) {
    let button = CONTROLS[key.toLowerCase()];
    if (button) {
      this.joypad.buttonPressed(button, state);
    }
  }
}


// TODO: Clean up this code

function createDMG() {
  let screenElem = document.getElementById('screen');
  let consoleElem = document.getElementById('console');
  let joypad = new Joypad();
  let mmu = new MMU(joypad);
  let ppu = new PPU(mmu);
  let screen = new LCDScreen(screenElem, ppu);
  let cpu = new CPU(mmu, ppu);
  let cons = new Console(consoleElem);
  return new DMG(cpu, ppu, mmu, screen, joypad, cons);
}

function loadRomFromFile(file) {
  let reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.onload = function() {
    window.dmg.loadRom(Array.from(new Uint8Array(reader.result)));
    window.dmg.start();
  }
}
function setupInputHandlers() {
  document.addEventListener('keydown', (e) => {
    window.dmg.keyPressed(e.key, true);
  });
  document.addEventListener('keyup', (e) => {
    window.dmg.keyPressed(e.key, false)
  });
}

window.onload = () => {
  window.dmg = createDMG();
  window.setupInputHandlers();
}

