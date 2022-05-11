// Constant values that need to be globally accessible
class Constants {

  // Emulator timing settings
  static CLOCK_SPEED = 4194304;
  static FRAMES_PER_SECOND = 60;
  static CYCLES_PER_FRAME = Constants.CLOCK_SPEED / Constants.FRAMES_PER_SECOND;

  // DMA transfer register
  static OAM_DMA_REG = 0xff46;

  // Interrupts
  static IE_REG = 0xffff; // interrupt enable
  static IF_REG = 0xff0f; // interrupt flags

  // Interrupt flags
  static IF_VBLANK  = 1 << 0;
  static IF_STAT    = 1 << 1;
  static IF_TIMER   = 1 << 2;
  static IF_SERIAL  = 1 << 3;
  static IF_JOYPAD  = 1 << 4;

  // Interrupt handlers
  static IH_VBLANK = 0x40;
  static IH_STAT = 0x48;
  static IH_TIMER = 0x50;
  static IH_SERIAL = 0x58;
  static IH_JOYPAD = 0x60;

  // LCD status register interrupt sources/flags
  static STAT_REG = 0xff41;
  static STAT_LYCLY_ENABLE    = 1 << 6;
  static STAT_OAM_ENABLE      = 1 << 5;
  static STAT_VBLANK_ENABLE   = 1 << 4;
  static STAT_HBLANK_ENABLE   = 1 << 3;
  static STAT_LYCLY_EQUAL     = 1 << 2;
  static STAT_HBLANK_MODE = 0;    // mode 0
  static STAT_VBLANK_MODE = 1;    // mode 1
  static STAT_OAM_MODE = 2;       // mode 2
  static STAT_TRANSFER_MODE = 3;  // mode 3

  // LCD control register and flags
  static LCDC_REG = 0xff40;
  static LCDC_ENABLE         = 1 << 7;
  static LCDC_WIN_TILEMAP    = 1 << 6;
  static LCDC_WIN_ENABLE     = 1 << 5;
  static LCDC_BGWIN_TILEDATA = 1 << 4;
  static LCDC_BG_TILEMAP     = 1 << 3;
  static LCDC_OBJ_SIZE       = 1 << 2;
  static LCDC_OBJ_ENABLE     = 1 << 1;
  static LCDC_BGWIN_ENABLE   = 1 << 0;

  // LCD Y coords
  static LY_REG = 0xff44;
  static LYC_REG = 0xff45;

  // BG palette
  static BGP_REG = 0xff47;

  // OBJ palette data
  static OBP0 = 0xff48;
  static OBP1 = 0xff49;

  // Misc PPU
  static SCROLLY_REG = 0xff42;
  static SCROLLX_REG = 0xff43;
  static WINX_REG = 0xff4b;
  static WINY_REG = 0xff4a;

  // Screen
  static VIEWPORT_WIDTH = 160;
  static VIEWPORT_HEIGHT = 144;

  // Joypad
  static JOYP_REG = 0xff00;
  static JOYP_P15 = 0x20; // Bit for b, a, select, start buttons (0 = select)
  static JOYP_P14 = 0x10; // Bit for up, down, left, right (0 = select)

  // Mapping for button -> type/value
  static JOYP_BUTTONS = {
    "up"      : [0, 4],
    "down"    : [0, 8],
    "left"    : [0, 2],
    "right"   : [0, 1],
    "b"       : [1, 2],
    "a"       : [1, 1],
    "select"  : [1, 4],
    "start"   : [1, 8],
  }

  // Timers and dividers
  static DIV_REG = 0xff04; // Divider register
  static TIMA_REG = 0xff05; // Timer counter
  static TMA_REG = 0xff06; // Timer modulo
  static TAC_REG = 0xff07; // Timer control
  static TAC_ENABLE = 4; // Timer enable
  static TAC_CLOCK_SELECT = [1024, 16, 64, 256]; // = CPU clock / (clock select)

  // Palette
  static DEFAULT_PALETTE = [
    [224, 248, 208],  // lightest
    [136, 192,112],   // light
    [52, 104,86],     // dark
    [8, 24, 32],      // darkest
  ];
}

window.Constants = Constants;
