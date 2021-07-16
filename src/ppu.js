/* global CYCLES_PER_FRAME, IF_REG, IE_REG, IF_VBLANK */
/* global STAT_REG, STAT_LYCLY_INT, STAT_OAM_INT, STAT_VBLANK_INT, STAT_HBLANK_INT */
/* global STAT_LYCLY_FLAG, STAT_TRANSFER_FLAG, STAT_OAM_FLAG, STAT_VBLANK_FLAG, STAT_HBLANK_FLAG */
/* global LCDC_REG, LCDC_ENABLE, LCDC_WINDOW_TILEMAP LCDC_WINDOW_ENABLE, LCDC_BGWINDOW_TILEDATA */
/* global LCDC_BG_TILEMAP, LCDC_OBJ_SIZE, LCDC_OBJ_ENABLE, LCDC_BGWINDOW_ENABLE */
/* global LY_REG, LYC_REG, BGP_REG, OBP0, OBP1 */
/* global tcBin2Dec */

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
"use strict"

const SCROLLY_REG = 0xff42;
const SCROLLX_REG = 0xff43;

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
    this.tileData = new Uint8Array(16);
    this.spriteData = new Uint8Array(16);
    this.x = 0;
    this.y = 0;
    this.frameBuf = null;
    this.cycles = 0;
    this.LCDEnabled = false;
    this.shouldUpdateScreen = false
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.frameBuf = new ImageData(FRAMEBUF_WIDTH, FRAMEBUF_HEIGHT);
    this.cycles = 0;
    this.LCDEnabled = false;
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
    this.LCDEnabled = this.readByte(LCDC_REG) & LCDC_ENABLE ? true : false;
    this.spriteHeight = this.readByte(LCDC_REG) & LCDC_OBJ_SIZE ? 16 : 8;

    // If LCD disabled, clear the screen
    if (! this.LCDEnabled) {
      // Returning early here might cause issues but we'll fix later
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

      // Trigger screen redraw
      this.shouldUpdateScreen = true;
    }

    let sprites = this.getSpritesForLine(this.y);

    // Draw background pixels for n cycles
    if (this.y < FRAMEBUF_HEIGHT) {
      let end = this.x + cycles;
      while (this.x < FRAMEBUF_WIDTH + 80) { // h-blank for 80 cycles - might be wrong.
        this.drawBackground(this.x, this.y);
        this.drawSprites(sprites, this.x, this.y);
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

    // BG tilemap begins at 0x9800 or 9c000
    let base = (this.readByte(LCDC_REG) & LCDC_BG_TILEMAP) ? 0x9c00 : 0x9800;
    return this.readByte(base + tileNum);
  }

  getTileData(tileIndex) {
    // Get tile data for tile id
    // Each tile uses 16 bytes of memory

    // When bg/win flag is NOT set:
    //  tiles 0-127   -> address range 0x9000 - 0x97ff
    //  tiles 128-255 -> address range 0x8800 - 0x8fff
    let base;

    if (this.readByte(LCDC_REG) & LCDC_BGWINDOW_TILEDATA) {
      base = 0x8000 + (16 * tileIndex);
    }
    else {
      base = 0x9000 + (16 * tcBin2Dec(tileIndex)); // Use signed tile index
    }
    for (let offset = 0; offset < 16; offset++) {
      this.tileData[offset] = this.readByte(base + offset);
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
    let tileX = (x + offsetX) % TILE_SIZE;
    let tileY = (y + offsetY) % TILE_SIZE;

    this.drawTile(tile, tileX, tileY, x, y);
  }

  drawTile(tile, tileX, tileY, posX, posY) {
    // Draws a single pixel of a tile at screen location x, y

    // test tile from https://www.huderlem.com/demos/gameboy2bpp.html
    //tile = [0xFF, 0x00, 0x7E, 0xFF, 0x85, 0x81, 0x89, 0x83, 0x93, 0x85, 0xA5, 0x8B, 0xC9, 0x97, 0x7E, 0xFF]
    let left = tile[tileY * 2];
    let right = tile[(tileY * 2) + 1];
    let bit = 1 << 7 - tileX;
    let hi = right & bit ? 1 : 0;
    let lo = left & bit ? 1 : 0;
    let color = (hi << 1) + lo;
    this.drawPixel(posX, posY, this.bgColor(color));
  }

  getSpriteOAM(address) {
    let flags = this.readByte(address + 3);
    return {
      y: this.readByte(address),
      x: this.readByte(address + 1),
      tileIndex: this.readByte(address + 2),
      bgPriority: flags & (1 << 7) ? 1 : 0,
      flipY: flags & (1 << 6) ? 1 : 0,
      flipX: flags & (1 << 5) ? 1 : 0,
      palette: flags & (1 << 4) ? 1 : 0,
      cgbVramBank: flags & (1 << 3) ? 1 : 0,
      cgbPalette: flags & 0b11,
    }
  }

  getSpriteData(spriteIndex) {
    let base = 0x8000 + (16 * spriteIndex);
    for (let offset = 0; offset < 16; offset++) {
      this.spriteData[offset] = this.readByte(base + offset);
    }
    return this.spriteData;
  }

  getSpritesForLine(line) {
    let address = 0xfe00;
    let sprites = [];

    for (let n = 0; n < 40; n++) {
      let curAddress = address + n * 4;
      let spriteY = this.readByte(curAddress) - 16; // sprite.y is vertical position on screen + 16
      if (spriteY <= line && spriteY + this.spriteHeight > line) {
        sprites.push(this.getSpriteOAM(curAddress));
      }
      // Max 10 sprites per line
      if (sprites.length > 10) {
        break;
      }
    }
    return sprites;
  }

  drawSprites(sprites, x, y) {
    for (let n = 0; n < sprites.length; n++) {
      let sprite = sprites[n];
      if (x >= sprite.x - 8 && x < sprite.x) {
        let tile = this.getSpriteData(sprite.tileIndex);
        let tileX = x - (sprite.x - 8); // sprite.x is horizontal position on screen + 8
        let tileY = y - (sprite.y - 16); // sprite.y is vertical position on screen + 16

        if (sprite.flipX) {
          tileX = 7 - tileX;
        }
        if (sprite.flipY) {
          tileY = (this.spriteHeight - 1) - tileY;
        }
        this.drawTile(tile, tileX, tileY, x, y);
      }
    }
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
