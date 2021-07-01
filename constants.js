const CLOCK_SPEED = 4194304
const FRAMES_PER_SECOND = 60;
const CYCLES_PER_FRAME = CLOCK_SPEED / FRAMES_PER_SECOND;

const CPU_FLAGS = {
  Z: 128, // zero
  N: 64,  // subtraction
  H: 32,  // half carry
  C: 16,  // carry
}

const SCROLLY_REG = 0xff42;
const SCROLLX_REG = 0xff43;

// LCD satus register and flags
const STAT_REG = 0xff41;
const STAT_LYCLY_INT = 64;
const STAT_OAM_INT = 32;
const STAT_VBLANK_INT = 16;
const STAT_HBLANK_INT = 8;
const STAT_LYCLY_FLAG = 4;
const STAT_TRANSFER_FLAG = 3;
const STAT_OAM_FLAG = 2;
const STAT_VBLANK_FLAG = 1;
const STAT_HBLANK_FLAG = 0;

// LCD control register and flags
const LCDC_REG = 0xff40;
const LCDC_ENABLE = 128;
const LCDC_WINDOW_TILEMAP = 64;
const LCDC_WINDOW_ENABLE = 32;
const LCDC_BGWINDOW_TILEDATA = 16;
const LCDC_BG_TILEMAP = 8;
const LCDC_OBJ_SIZE = 4;
const LCDC_OBJ_ENABLE = 2;
const LCDC_BGWINDOW_ENABLE = 1;

// LCD Y coords
const LY_REG = 0xff44;
const LYC_REG = 0xff45;

// BG palette
const BGP_REG = 0xff47;

// OBJ palette data
const OBP0 = 0xff48;
const OBP1 = 0xff49;

// Joypad register
const JOYP_REG = 0xff00;
const OAM_DMA_REG = 0xff46;

// Interrupts
const IE_REG = 0xffff;
const IF_REG = 0xff0f;

// Interrupt flags
const IF_VBLANK = 1;
const IF_LCDSTAT = 2;
const IF_TIMER = 4;
const IF_SERIAL = 8;
const IF_JOYPAD = 16;

// Interrupt handlers
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

