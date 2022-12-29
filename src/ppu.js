// PPU
class PPU {
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

  // Palette
  static DEFAULT_PALETTE = [
    [224, 248, 208],  // lightest
    [136, 192, 112],   // light
    [52, 104,86],     // dark
    [8, 24, 32],      // darkest
  ];

  /*
   * Memory Locations:
   *
   * 0x8000 0x8fff: Sprite tiles
   * 0x9800 0x9bff: BG tile map (0)
   * 0xfe00 0xfe9f: Sprit OAM table
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

  constructor(dmg) {
    this.dmg = dmg;
    this.tileData = new Uint8Array(16);
    this.spriteData = new Uint8Array(32);
    this.spriteHeight = 8;
    this.tileSize = 8;
    this.bgNumTiles = 32;
    this.bgColorId = 0;
    this.x = 0;
    this.y = 0;
    this.frameBuf = null;
    this.cycles = 0;
    this.LCDEnabled = false;
    this.sprites = [];
    this.LCDC = 0;
    this.scrollX = 0;
    this.scrollY = 0;
    this.winX = 0;
    this.winY = 0;
    this.BGP = 0;
    this.dots = 0;
    this.skipFrame = true;
    this.palette = PPU.DEFAULT_PALETTE;
  }

  reset() {
    this.screen = this.dmg.screen;
    this.mmu = this.dmg.mmu;
    this.x = 0;
    this.y = 0;
    this.frameBuf = new ImageData(PPU.VIEWPORT_WIDTH, PPU.VIEWPORT_HEIGHT);
    this.cycles = 0;
    this.LCDEnabled = false;
    this.sprites = [];
    this.dots = 0;
    this.skipFrame = true;
  }

  readByte(loc) {
    return this.mmu.readByte(loc);
  }

  writeByte(loc, value) {
    return this.mmu.writeByte(loc, value);
  }

  setStatMode(statMode) {
    // clear lower two status bits of STAT register and set new STAT mode
    let stat = this.readByte(PPU.STAT_REG);
    stat &= ~0x3;
    this.writeByte(PPU.STAT_REG, stat | statMode);
  }

  // Test if LYC=LY and request interrupt
  evalLYCLYInterrupt() {
    const stat = this.readByte(PPU.STAT_REG);
    const LYCLYEqual = this.readByte(PPU.LYC_REG) === this.readByte(PPU.LY_REG);

    if (LYCLYEqual && stat & PPU.STAT_LYCLY_ENABLE) {
      this.writeByte(CPU.IF_REG, this.readByte(CPU.IF_REG) | CPU.IF_STAT);
      this.writeByte(PPU.STAT_REG, stat | PPU.STAT_LYCLY_EQUAL);
    }
  }

  // Evaluate STAT interrupt line and request interrupt
  evalStatInterrupt() {

    const stat = this.mmu.readByte(PPU.STAT_REG);
    const statMode = stat & 0x3;
    let interrupt;

    switch (statMode) {
      case PPU.STAT_HBLANK_MODE:
        interrupt = stat & PPU.STAT_HBLANK_ENABLE;
        break;

      case PPU.STAT_VBLANK_MODE:
        interrupt = stat & PPU.STAT_VBLANK_ENABLE;
        break;

      case PPU.STAT_OAM_MODE:
        interrupt = stat & PPU.STAT_OAM_ENABLE;
        break;

      case PPU.STAT_TRANSFER_MODE:
        interrupt = stat & PPU.STAT_TRANSFER_ENABLE;
        break;
      default:
    }
    if (interrupt) {
      this.writeByte(CPU.IF_REG, this.readByte(CPU.IF_REG) | CPU.IF_STAT);
    }
  }

  // Update the PPU for (n) cycles
  update(cycles) {
    const statMode = null;

    this.cycles += cycles;
    this.LCDC = this.readByte(PPU.LCDC_REG);
    this.LCDEnabled = this.LCDC & PPU.LCDC_ENABLE ? true : false;

    // LCD state changed to disabled
    if (! this.LCDEnabled) {
      this.writeByte(PPU.LY_REG, 0);
      this.evalLYCLYInterrupt();
      this.setStatMode(PPU.STAT_MODE_HBLANK);
      this.skipFrame = true; // Skip first frame when enabling LCD - screen garbage otherwise
      return;
    }

    this.scrollX = this.readByte(PPU.SCROLLX_REG);
    this.scrollY = this.readByte(PPU.SCROLLY_REG);
    this.winX = this.readByte(PPU.WINX_REG) - 7; // winX = window position - 7 (hardware bug?)
    this.winY = this.readByte(PPU.WINY_REG);
    this.BGP = this.readByte(PPU.BGP_REG);

    // For each CPU cycle, advance the PPU's state
    while (cycles--) {
      // OAM scan for 80 dots (cycles) while not in VBLANK
      if (this.y < 144 && this.dots < 80) {
        if (this.dots === 0) {
          this.setStatMode(PPU.STAT_OAM_MODE);
        }
        this.dots++;
      }
      else {
        // Render BG and sprites if x & y are within screen boundary and respective layer is enabled
        if (this.x < PPU.VIEWPORT_WIDTH && this.y < PPU.VIEWPORT_HEIGHT) {
          if (this.LCDC & PPU.LCDC_BGWIN_ENABLE) {
            if (this.dmg.cgbMode) {
              this.cgbDrawBackground(this.x, this.y);
            }
            else {
              this.drawBackground(this.x, this.y);
            }
          }
          if (this.LCDC & PPU.LCDC_BGWIN_ENABLE && this.LCDC & PPU.LCDC_WIN_ENABLE) {
            this.drawWindow(this.x, this.y);
          }
          if (this.LCDC & PPU.LCDC_OBJ_ENABLE) {
            this.drawSprites(this.x, this.y);
          }
        }
        // End HBLANK - update next scanline
        if (this.dots == 456) {
          this.x = 0;
          this.y++;
          this.dots = 0;

          // New line outside VBLANK - return to OAM mode
          if (this.y < 144) {
            this.setStatMode(PPU.STAT_OAM_MODE);
          }
          // End VBLANK - reset to scanline 0
          else if (this.y == 154) {
            this.y = 0;
            this.setStatMode(PPU.STAT_OAM_MODE);
          }

          // Begin VBLANK
          else if (this.y == 144) {
            // Set VBLANK STAT mode & interrupt flag
            this.setStatMode(PPU.STAT_VBLANK_MODE);
            this.writeByte(CPU.IF_REG, this.readByte(CPU.IF_REG) | CPU.IF_VBLANK);

            if (this.LCDEnabled && ! this.skipFrame) {
              this.screen.update(this.frameBuf);
            }
            this.skipFrame = false;
          }

          // Update LYC=LY
          this.writeByte(PPU.LY_REG, this.y);
          this.evalLYCLYInterrupt();

          // Get sprites for the current line
          this.sprites = this.getSpritesForLine(this.y);

        }
        // Set STAT mode when in non-VBLANK state
        else {
          if (this.y < 144) {
            if (this.dots === 80) {
              this.setStatMode(PPU.STAT_TRANSFER_MODE);
            }
            else if (this.dots === 252) {
              this.setStatMode(PPU.STAT_HBLANK_MODE);
            }
          }
          this.x++;
          this.dots++;
        }
      }
    }
    this.evalStatInterrupt();
  }

  getColorRGB(colorId, palette) {
    return this.palette[(palette >> (2 * colorId)) & 0b11];
  }

  cgbGetColorRGB(colorId, paletteId, ram) {
    const offset = paletteId * 8 + colorId * 2;
    const color = uint16(ram[offset + 1], ram[offset]);

    // Convert from 15 to 24-bit color
    // TODO: Is there a better way to do it?
    return [
      (color & 0x1f) * 8,
      ((color >> 5) & 0x1f) * 8,
      ((color >> 10) & 0x1f) * 8,
    ];
  }

  // Return tile index info for x, y coord from vram bank at base address
  getTileIndex(x, y, vram, base) {
    const yTiles = Math.floor(y / this.tileSize) % this.bgNumTiles;
    const xTiles = Math.floor(x / this.tileSize) % this.bgNumTiles;
    const tileNum = xTiles + yTiles * this.bgNumTiles;
    return vram[base + tileNum - 0x8000];
  }

  // Get tile data for tile id from vram bank
  // Each tile uses 16 bytes of memory
  getTileData(tileIndex, vram) {

    // When bg/win flag is NOT set:
    //  tiles 0-127   -> address range 0x9000 - 0x97ff
    //  tiles 128-255 -> address range 0x8800 - 0x8fff
    const tile = new Uint8Array(16);
    let index;

    if (this.LCDC & PPU.LCDC_BGWIN_TILEDATA) {
      // Use address 0x8000
      index = 16 * tileIndex;
    }
    else {
      // Use address 0x9000
      index = 0x1000 + (16 * tcBin2Dec(tileIndex)); // Use signed tile index
    }
    for (let offset = 0; offset < 16; offset++) {
      tile[offset] = vram[index + offset]; // Faster to access vram array directly
    }
    return tile;
  }

  cgbDrawBackground(x, y) {
    // BG tilemap begins at 0x9800 or 0x9c000
    const base = this.LCDC & PPU.LCDC_BG_TILEMAP ? 0x9c00 : 0x9800;
    const tileIndex = this.getTileIndex(x + this.scrollX, y + this.scrollY, this.mmu.vram, base);

    // CGB BG attributes
    const bgAttrs = this.getTileIndex(x + this.scrollX, y + this.scrollY, this.mmu.vram1, base);
    const paletteId = bgAttrs & 0x7;

    // Check if tile data stored in second VRAM bank
    const vram = ((bgAttrs & (1 << 3)) !== 0) ? this.mmu.vram1 : this.mmu.vram;
    const tile = this.getTileData(tileIndex, vram);
    const tileX = (x + this.scrollX) % this.tileSize;
    const tileY = (y + this.scrollY) % this.tileSize;

    const bgColorId = this.getPixelColorId(tile, tileX, tileY);
    const rgb = this.cgbGetColorRGB(bgColorId, paletteId, this.mmu.bgPalette);

    this.drawPixel(x, y, rgb);

    // Save color id of pixel x, y for bg/obj priority when rendering sprites
    this.bgColorId = bgColorId;
  }

  // Draws a single pixel of the BG tilemap for x, y
  drawBackground(x, y) {
    // BG tilemap begins at 0x9800 or 0x9c000
    const base = this.LCDC & PPU.LCDC_BG_TILEMAP ? 0x9c00 : 0x9800;
    const tileIndex = this.getTileIndex(x + this.scrollX, y + this.scrollY, this.mmu.vram, base);
    const tile = this.getTileData(tileIndex, this.mmu.vram);
    const tileX = (x + this.scrollX) % this.tileSize;
    const tileY = (y + this.scrollY) % this.tileSize;
    const bgColorId = this.getPixelColorId(tile, tileX, tileY);
    const rgb = this.getColorRGB(bgColorId, this.BGP);

    this.drawPixel(x, y, rgb);

    // Save color id of pixel x, y for bg/obj priority when rendering sprites
    this.bgColorId = bgColorId;
  }

  drawWindow(x, y) {
    // Check if x, y within window boundary
    if (x < this.winX || y < this.winY) {
      return;
    }
    // Window tilemap begins at 0x9800 or 9c000
    const base = this.LCDC & PPU.LCDC_WIN_TILEMAP ? 0x9c00 : 0x9800;

    const tileIndex = this.getTileIndex(x - this.winX, y - this.winY, this.mmu.vram, base);
    const tileX = (x - this.winX) % this.tileSize;
    const tileY = (y - this.winY) % this.tileSize;

    if (this.dmg.cgbMode) {
      const bgAttrs = this.getTileIndex(x + this.scrollX, y + this.scrollY, this.mmu.vram1, base);
      const paletteId = bgAttrs & 0x7;

      // Check if tile data stored in second VRAM bank
      const vram = ((bgAttrs & (1 << 3)) !== 0) ? this.mmu.vram1 : this.mmu.vram;
      const tile = this.getTileData(tileIndex, vram);
      const colorId = this.getPixelColorId(tile, tileX, tileY);
      const rgb = this.cgbGetColorRGB(colorId, paletteId, this.mmu.bgPalette);
      this.drawPixel(x, y, rgb);
    }
    else {
      const tile = this.getTileData(tileIndex, this.mmu.vram);
      const colorId = this.getPixelColorId(tile, tileX, tileY);
      const rgb = this.getColorRGB(colorId, this.BGP);
      this.drawPixel(x, y, rgb);
    }
  }

  // Get color id of tile data at pixel x,y
  getPixelColorId(tile, x, y) {
    // test tile from https://www.huderlem.com/demos/gameboy2bpp.html
    //tile = [0xFF, 0x00, 0x7E, 0xFF, 0x85, 0x81, 0x89, 0x83, 0x93, 0x85, 0xA5, 0x8B, 0xC9, 0x97, 0x7E, 0xFF];
    const left = tile[y * 2];
    const right = tile[(y * 2) + 1];
    const bit = 1 << 7 - x;
    const hi = right & bit ? 1 : 0;
    const lo = left & bit ? 1 : 0;
    return (hi << 1) + lo;
  }

  // Get sprite OAM data at (index)
  getSpriteOAM(index) {
    const oam = this.mmu.oam;
    const offset = index * 4;
    const flags = oam[offset + 3];
    return {
      y: oam[offset],
      x: oam[offset + 1],
      tileIndex: oam[offset + 2],
      bgPriority: flags & (1 << 7) ? true : false,
      flipY: flags & (1 << 6) ? true : false,
      flipX: flags & (1 << 5) ? true : false,
      obp: flags & (1 << 4) ? true : false,
      cgbVramBank1: flags & (1 << 3) ? true : false,
      cgbPaletteId: flags & 0b11,
      oamAddress: offset,
      oamIndex: index,
    };
  }

  getSpriteData(spriteIndex, vram) {
    const end = this.spriteHeight * 2;
    const sprite = new Uint8Array(32);
    // sprite index: ignore bit 0 when in 8x16 sprite mode
    if (this.spriteHeight === 16) {
      spriteIndex &= ~0x1;
    }
    for (let offset = 0; offset < end; offset++) {
      sprite[offset] = vram[(spriteIndex * 16) + offset];
    }
    return sprite;
  }

  getSpritesForLine(line) {
    const oam = this.mmu.oam;
    const sprites = [];

    for (let index = 0; index < 40; index++) {
      const spriteY = oam[index * 4] - 16; // sprite.y is vertical position on screen + 16
      if (spriteY <= line && spriteY + this.spriteHeight > line) {
        sprites.push(this.getSpriteOAM(index));
      }
      // Max 10 sprites per line
      if (sprites.length > 10) {
        break;
      }
    }
    return sprites;
  }

  drawSprites(x, y) {
    this.spriteHeight = this.LCDC & PPU.LCDC_OBJ_SIZE ? 16 : 8;

    for (let n = 0; n < this.sprites.length; n++) {
      const sprite = this.sprites[n];

      if (x >= sprite.x - 8 && x < sprite.x) {
        const vram = (this.dmg.cgbMode && sprite.cgbVramBank1) ? this.mmu.vram1 : this.mmu.vram;
        const tile = this.getSpriteData(sprite.tileIndex, vram);

        let tileX = x - (sprite.x - 8); // sprite.x is horizontal position on screen + 8
        let tileY = y - (sprite.y - 16); // sprite.y is vertical position on screen + 16

        if (sprite.flipX) {
          tileX = 7 - tileX;
        }
        if (sprite.flipY) {
          tileY = (this.spriteHeight - 1) - tileY;
        }
        const colorId = this.getPixelColorId(tile, tileX, tileY);

        // BG over obj priority
        if (sprite.bgPriority && this.bgColorId > 0) {
          continue;
        }
        // transparent pixel
        if (colorId == 0) {
          continue;
        }
        if (this.dmg.cgbMode) {
          const rgb = this.cgbGetColorRGB(colorId, sprite.cgbPaletteId, this.mmu.objPalette);
          this.drawPixel(x, y, rgb);
        }
        else {
          const rgb = this.getColorRGB(colorId, this.readByte(sprite.obp ? PPU.OBP1 : PPU.OBP0));
          this.drawPixel(x, y, rgb);
        }
      }
    }
  }

  drawPixel(x, y, rgb) {
    const data = this.frameBuf.data;
    const offset = (y * PPU.VIEWPORT_WIDTH + x) * 4;

    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255; // alpha
  }
}
window.PPU = PPU;
