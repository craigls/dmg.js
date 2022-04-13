const concat = require('concat');

var sourceFiles = [
  'src/header.js',
  'src/constants.js',
  'src/utils.js',
  'src/dmg.js',
  'src/cpu.js',
  'src/mmu.js',
  'src/ppu.js',
  'src/apu.js',
  'src/screen.js',
  'src/joypad.js',
  //'src/vramviewer.js',
  'src/footer.js',
]

var outputFile = 'dist/index.js';

concat(sourceFiles, outputFile);
