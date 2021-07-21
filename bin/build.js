const concat = require('concat');

var sourceFiles = [
  'src/header.js',
  'src/constants.js',
  'src/utils.js',
  'src/dmg.js',
  'src/cpu.js',
  'src/ppu.js',
  'src/mmu.js',
  'src/screen.js',
  'src/joypad.js',
  'src/console.js',
  'src/footer.js',
]

var outputFile = 'dist/dmg.js';

concat(sourceFiles, outputFile);
