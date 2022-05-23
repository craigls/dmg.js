const concat = require('concat');

var sourceFiles = [
  'src/header.js',
  'src/utils.js',
  'src/cpu.js',
  'src/mmu.js',
  'src/ppu.js',
  'src/apu.js',
  'src/screen.js',
  'src/joypad.js',
  'src/dmg.js',
  'src/footer.js',
]

var outputFile = 'dist/index.js';

concat(sourceFiles, outputFile);
