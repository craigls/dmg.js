/* global CYCLES_PER_FRAME, IF_REG, IE_REG, IF_VBLANK */

/* 0x8000 0x8fff: Sprite tiles
 * 0x9800 0x9bff: BG tile map (0)
 * 0xfe00 0xfe9f: Sprit OAM table
 *
 *
 * VRAM Sprite Attributes Table:
 *
 * byte 0: y position
 * byte 1: x position
 * byte 2: tile index
 * byte 3: attributes/flags:
 * bit 7: bg and window over obj (0=no, 1=bg and window colors 1-3 over obj)
 * bit 6: y flip
 * bit 5: x flip
 * bit 4: paletter number
 * bit 3: gameboy color only
 * bit 2-0: gameboy color only
 *
 */

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

// Other stuff
const BG_NUM_TILES = 32;
const TILE_SIZE = 8;
const FRAMEBUF_WIDTH = 256;
const FRAMEBUF_HEIGHT = 256;
const DEFAULT_PALETTE = [
  [155, 188, 15], // lightest
  [139, 172, 15], // light
  [48,  98,  48], // dark
  [15,  56,  15], // darkest
];

class PPU {
  constructor(mmu) {
    this.mmu = mmu;
    this.frameBuf = null;
    this.x = 0;
    this.y = 0;
    this.tileData = new Array(16);
    this.cycles = 0;
  }
  
  reset() {
    this.x = 0;
    this.y = 0;
    this.frameBuf = new ImageData(FRAMEBUF_WIDTH, FRAMEBUF_HEIGHT);
  }

  readByte(loc) {
    return this.mmu.readByte(loc);
  }

  writeByte(loc, value) {
    return this.mmu.writeByte(loc, value);
  }

  setStatMode(flag) {
    let stat = this.readByte(STAT_REG);
    stat &= ~STAT_VBLANK_FLAG;
    stat &= ~STAT_HBLANK_FLAG; 
    stat &= ~STAT_OAM_FLAG;
    stat &= ~STAT_TRANSFER_FLAG;
    stat |= flag;
    this.writeByte(STAT_REG, stat);
  }

  cycleStatMode() {
    let n = Math.floor(this.cycles / CYCLES_PER_FRAME) % 3;
    switch (n) {
      case 0:
        this.setStatMode(STAT_OAM_FLAG);
        break;
      case 1:
        this.setStatMode(STAT_TRANSFER_FLAG);
        break;
      case 2:
        this.setStatMode(STAT_HBLANK_FLAG);
        break
    }
  }

  update(cycles) {
    this.cycles += cycles;

    // If LCD disabled, clear the screen and return early
    if (! (this.readByte(LCDC_REG) & LCDC_ENABLE)) {
      this.frameBuf.data.fill(DEFAULT_PALETTE[0]);
      return;
    }

    if (this.x >= FRAMEBUF_WIDTH) {
      this.x = 0;
      this.y++;
    }

    // Begin vblank at scanline 144
    if (this.y == 144) {
      this.writeByte(IF_REG, this.readByte(IF_REG) | IF_VBLANK);
      this.writeByte(STAT_REG, this.readByte(STAT_REG) | STAT_VBLANK_FLAG);
    }

    // If not vblank: cycle LCD status modes
    else if (this.y < 144) {
      this.cycleStatMode();
    }

    // End of vblank
    else if (this.y == 154) {
      this.writeByte(IF_REG, this.readByte(IF_REG) & ~IF_VBLANK);
      this.writeByte(STAT_REG, this.readByte(STAT_REG) & ~STAT_VBLANK_FLAG);
      this.y = 0;
    }

    // Draw background pixels for n cycles
    if (this.y < FRAMEBUF_HEIGHT) {
      let end = this.x + cycles;
      while (this.x < FRAMEBUF_WIDTH + 80) { // h-blank for 80 cycles - might be wrong.
        this.drawBackground(this.x, this.y);
        this.x++;
        if (this.x == end) {
          break;
        }
      }
    }
    this.writeByte(LY_REG, this.y);
    this.writeByte(LYC_REG, this.y);
  }

  bgColor(n) {
    return DEFAULT_PALETTE[(this.mmu.readByte(BGP_REG) >> (2 * n)) & 0b11];
  }
    
  getTileAtCoords(x, y) {
    // Finds the memory address of tile containing pixel at x, y
    let yTiles = Math.floor(y / TILE_SIZE) * BG_NUM_TILES;
    let xTiles = Math.floor(x / TILE_SIZE);

    // Get the offset for the tile address. Wraps back to zero if tileNum > 1023
    let tileNum = (xTiles + yTiles) % (BG_NUM_TILES * BG_NUM_TILES);

    // BG tilemap begins at 0x9800;
    return this.readByte(0x9800 + tileNum);
  }

  getTileData(tileIndex) {
    // Get tile data for tile id 
    // Each tile uses 16 bytes of memory
    
    // get tile data base address via bit 4 of LCDC register
    let base = LCDC_REG & LCDC_BG_TILEMAP ? 0x8800 : 0x8000;
    let address = base + (16 * tileIndex); 

    for (let offset = 0; offset < 16; offset++) {
      this.tileData[offset] = this.readByte(address + offset);
    }
    return this.tileData;
  }

  drawBackground(x, y) {
    // Draws a single pixel of the BG tilemap for x, y

    let scrollX = this.readByte(SCROLLX_REG) % 255;
    let scrollY = this.readByte(SCROLLY_REG) % 255;

    let offsetX = scrollX % TILE_SIZE;
    let offsetY = scrollY % TILE_SIZE;

    let tileIndex = this.getTileAtCoords(x + scrollX, y + scrollY);
    let tile = this.getTileData(tileIndex);
    this.drawTile(tile, x, y, offsetX, offsetY);
  }

  drawTile(tile, xPos, yPos, offsetX=0, offsetY=0) {
    // Draws a pixel for at x, y with an offset
    let x = (xPos + offsetX) % TILE_SIZE;
    let y = (yPos + offsetY) % TILE_SIZE;
   
    // test tile from https://www.huderlem.com/demos/gameboy2bpp.html
    //tile = [0xFF, 0x00, 0x7E, 0xFF, 0x85, 0x81, 0x89, 0x83, 0x93, 0x85, 0xA5, 0x8B, 0xC9, 0x97, 0x7E, 0xFF]
    let left = tile[(y * 2)];
    let right = tile[(y * 2) + 1];
    let bit = (1 << (7 - x));
    let hi = (right & bit) ? 1 : 0;
    let lo = (left & bit) ? 1 : 0;
    let color = (hi << 1) + lo;
    this.drawPixel(xPos, yPos, this.bgColor(color));
  }
  
  drawPixel(x, y, rgb) {
    let data = this.frameBuf.data;
    let offset = (y * FRAMEBUF_WIDTH + x) * 4;

    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255; // alpha
  }
}
