const TEST_MODE_ENABLED = true;
const CLOCK_SPEED = 4194304
const FRAMES_PER_SECOND = 60;
const CYCLES_PER_FRAME = CLOCK_SPEED / FRAMES_PER_SECOND;

const Z_FLAG = 128; // zero
const N_FLAG = 64; // subtraction
const H_FLAG = 32; // half carry
const C_FLAG = 16; // carry

const SCROLLY_REG = 0xff42;
const SCROLLX_REG = 0xff43;
const LY_REG = 0xff44;
const LYC_REG = 0xff45;
const BGP_REG = 0xff47;
const STAT_REG = 0xff41;
const JOYP_REG = 0xff00;
const OAM_DMA_REG = 0xff46;
const STAT_TRANSFER_FLAG = 0x11;
const STAT_OAM_FLAG = 0x10;
const STAT_VBLANK_FLAG = 0x01;
const STAT_HBLANK_FLAG = 0x00;
const IE_REG = 0xffff;
const IF_REG = 0xff0f;
const IF_VBLANK = 0;
const IF_LCDSTAT = 1;
const IF_TIMER = 2;
const IF_SERIAL = 3;
const IF_JOYPAD = 4;
const IH_VBLANK = 0x40;
const IH_LCDSTAT = 0x48;
const IH_TIMER = 0x50;
const IH_SERIAL = 0x58;
const IH_JOYPAD = 0x60;

const BG_NUM_TILES = 32;
const TILE_SIZE = 8;
const FRAMEBUF_WIDTH = 256;
const FRAMEBUF_HEIGHT = 256;
const VIEWPORT_WIDTH = 160;
const VIEWPORT_HEIGHT = 144;

const DEFAULT_PALETTE = [
  [155, 188, 15], // lightest
  [139, 172, 15], // light
  [48,  98,  48], // dark
  [15,  56,  15], // darkest
];

