const CLOCK_SPEED = 4194304
const FRAMES_PER_SECOND = 60;
const CYCLES_PER_FRAME = CLOCK_SPEED / FRAMES_PER_SECOND;

// Joypad register
const JOYP_REG = 0xff00;
// DMA transfer register
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
