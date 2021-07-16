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

    // Set default state per https://gbdev.io/pandocs/Power_Up_Sequence.html
    
    this.mmu.writeByte(0xff07, 0x00);
    this.mmu.writeByte(0xff10, 0x80);
    this.mmu.writeByte(0xff11, 0xbf);
    this.mmu.writeByte(0xff12, 0xf3);
    this.mmu.writeByte(0xff14, 0xbf);
    this.mmu.writeByte(0xff16, 0x3f);
    this.mmu.writeByte(0xff17, 0x00);
    this.mmu.writeByte(0xff19, 0xbf);
    this.mmu.writeByte(0xff1a, 0x7f);
    this.mmu.writeByte(0xff1b, 0xff);
    this.mmu.writeByte(0xff1c, 0x9f);
    this.mmu.writeByte(0xff1e, 0xbf);
    this.mmu.writeByte(0xff20, 0xff);
    this.mmu.writeByte(0xff21, 0x00);
    this.mmu.writeByte(0xff22, 0x00);
    this.mmu.writeByte(0xff23, 0xbf);
    this.mmu.writeByte(0xff24, 0x77);
    this.mmu.writeByte(0xff25, 0xf3);
    this.mmu.writeByte(0xff26, 0xf1);
    this.mmu.writeByte(0xff40, 0x91);
    this.mmu.writeByte(0xff42, 0x00);
    this.mmu.writeByte(0xff43, 0x00);
    this.mmu.writeByte(0xff45, 0x00);
    this.mmu.writeByte(0xff47, 0xfc);
    this.mmu.writeByte(0xff48, 0xff);
    this.mmu.writeByte(0xff49, 0xff);
    this.mmu.writeByte(0xff4a, 0x00);
    this.mmu.writeByte(0xff4b, 0x00);
    this.mmu.writeByte(0xffff, 0x00);

    let AF = 0x01b0;
    let BC = 0x0013;
    let DE = 0x00d8;
    let HL = 0x014d;

    this.cpu.A = AF >> 8;
    this.cpu.F = AF & 0xff;
    this.cpu.B = BC >> 8;
    this.cpu.C = BC & 0xff;
    this.cpu.D = DE >> 8;
    this.cpu.E = DE & 0xff;
    this.cpu.H = HL >> 8;
    this.cpu.L = HL & 0xff;
    this.cpu.SP = 0xfffe;
    this.cpu.PC = 0x100; // Skip checksum routines and begin at ROM address 0x100
  }

  loadRom(rom) {
    this.reset();
    this.mmu.loadRom(rom);
  }

  start() {
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
    //requestAnimationFrame(() => this.console ? this.console.update(this) : {});
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

