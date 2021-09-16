// PPU
class PPU {
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

  constructor(mmu) {
    this.mmu = mmu;
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
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.frameBuf = new ImageData(Constants.VIEWPORT_WIDTH, Constants.VIEWPORT_HEIGHT);
    this.cycles = 0;
    this.LCDEnabled = false;
    this.sprites = [];
  }

  readByte(loc) {
    return this.mmu.readByte(loc);
  }

  writeByte(loc, value) {
    return this.mmu.writeByte(loc, value);
  }

  setStatMode(statMode) {
    let stat = this.readByte(Constants.STAT_REG);
    stat &= ~(
        Constants.STAT_VBLANK_MODE
      | Constants.STAT_HBLANK_MODE
      | Constants.STAT_OAM_MODE
      | Constants.STAT_TRANSFER_MODE
    );
    this.writeByte(Constants.STAT_REG, stat | statMode);
  }

  // Test if LYC=LY and request interrupt
  evalLYCLYInterrupt() {
    let stat = this.readByte(Constants.STAT_REG);
    let LYCLYEqual = this.readByte(Constants.LYC_REG) === this.readByte(Constants.LY_REG);

    if (LYCLYEqual && stat & Constants.STAT_LYCLY_ENABLE) {
      this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) | Constants.IF_STAT);
      this.writeByte(Constants.STAT_REG, stat | Constants.STAT_LYCLY_EQUAL);
    }
  }

  // Evaluate STAT interrupt line and request interrupt
  evalStatInterrupt() {
    let stat = this.readByte(Constants.STAT_REG);
    let interrupt = stat & Constants.STAT_OAM_MODE && stat & Constants.STAT_OAM_ENABLE;
    interrupt ||= stat & Constants.STAT_VBLANK_MODE && stat & Constants.STAT_VBLANK_ENABLE;
    interrupt ||= stat & Constants.STATS_HBLANK_MODE && stat & Constants.STAT_HBLANK_ENABLE;

    if (interrupt) {
      this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) | Constants.IF_STAT);
    }
  }

  // Update the PPU for (n) cycles
  update(cycles) {
    let statMode;

    this.cycles += cycles;

    // Cache these register values so we're not constantly looking them up
    this.LCDEnabled = this.LCDC & Constants.LCDC_ENABLE ? true : false;
    this.LCDC = this.readByte(Constants.LCDC_REG);
    this.scrollX = this.readByte(Constants.SCROLLX_REG);
    this.scrollY = this.readByte(Constants.SCROLLY_REG);
    this.winX = this.readByte(Constants.WINX_REG) - 7; // winX = window position - 7 (hardware bug?)
    this.winY = this.readByte(Constants.WINY_REG);
    this.BGP = this.readByte(Constants.BGP_REG);

    // LCD Disabled
    if (! this.LCDEnabled) {
      this.writeByte(Constants.LY_REG, 0);
      this.evalLYCLYInterrupt();
      // TODO: clear screen
      return;
    }

    // For each CPU cycle, advance the PPU's state
    while (cycles--) {
      // Render BG and sprites if x & y are within screen boundary and respective layer is enabled
      if (this.x < Constants.VIEWPORT_WIDTH && this.y < Constants.VIEWPORT_HEIGHT) {
        if (this.LCDC & Constants.LCDC_BGWIN_ENABLE) {
          this.drawBackground(this.x, this.y);
        }
        if (this.LCDC & Constants.LCDC_BGWIN_ENABLE && this.LCDC & Constants.LCDC_WIN_ENABLE) {
          this.drawWindow(this.x, this.y);
        }
        if (this.LCDC & Constants.LCDC_OBJ_ENABLE) {
          this.drawSprites(this.x, this.y, this.bgColorId);
        }
      }

      // End HBLANK - update next scanline
      if (this.x == 456) {
        this.x = 0;
        this.y++;

        // Begin VBLANK
        if (this.y == 144) {
          // Set VBLANK STAT mode & interrupt flag
          statMode = Constants.STAT_VBLANK_MODE;
          this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) | Constants.IF_VBLANK);
        }

        // End VBLANK - reset to scanline 0
        else if (this.y == 154) {
          this.y = 0;
        }

        // Update LYC=LY
        this.writeByte(Constants.LY_REG, this.y);
        this.evalLYCLYInterrupt();

        // Get sprites for the current line
        this.sprites = this.getSpritesForLine(this.y);

      }
      // Set STAT mode when in non-VBLANK state
      else {
        if (this.y < 144) {
          if (this.x === 0) {
            statMode = Constants.STAT_OAM_MODE;
          }
          else if (this.x === 80) {
            statMode = Constants.STAT_TRANSFER_MODE;
          }
          else if (this.x === 252) {
            statMode = Constants.STAT_HBLANK_MODE;
          }
        }
        this.x++;
      }
    }

    let curStatMode = this.readByte(Constants.STAT_REG) & 0b11;

    // Update STAT mode if different than current
    if (statMode !== curStatMode) {
      this.setStatMode(statMode);
      this.evalStatInterrupt();
    }
  }

  getColorRGB(colorId, palette) {
    return Constants.DEFAULT_PALETTE[(palette >> (2 * colorId)) & 0b11];
  }

  // Finds the memory address of tile containing pixel at x, y for tilemap base address
  getTileAtCoords(x, y, base) {
    let yTiles = Math.floor(y / this.tileSize) % this.bgNumTiles;
    let xTiles = Math.floor(x / this.tileSize) % this.bgNumTiles;

    // Get the offset for the tile address. Wraps back to zero if tileNum > 1023
    let tileNum = xTiles + yTiles * this.bgNumTiles;

    return this.readByte(base + tileNum);
  }

  // Get tile data for tile id
  // Each tile uses 16 bytes of memory
  getTileData(tileIndex) {

    // When bg/win flag is NOT set:
    //  tiles 0-127   -> address range 0x9000 - 0x97ff
    //  tiles 128-255 -> address range 0x8800 - 0x8fff
    let vram = this.mmu.vram;
    let index;

    if (this.LCDC & Constants.LCDC_BGWIN_TILEDATA) {
      // Use address 0x8000
      index = 16 * tileIndex;
    }
    else {
      // Use address 0x9000
      index = 0x1000 + (16 * tcBin2Dec(tileIndex)); // Use signed tile index
    }
    for (let offset = 0; offset < 16; offset++) {
      this.tileData[offset] = vram[index + offset]; // Faster to access vram array directly
    }
    return this.tileData;
  }

  // Draws a single pixel of the BG tilemap for x, y
  drawBackground(x, y) {
    // BG tilemap begins at 0x9800 or 9c000
    let base = this.LCDC & Constants.LCDC_BG_TILEMAP ? 0x9c00 : 0x9800;
    let tileIndex = this.getTileAtCoords(x + this.scrollX, y + this.scrollY, base);
    let tile = this.getTileData(tileIndex);
    let tileX = (x + this.scrollX) % this.tileSize;
    let tileY = (y + this.scrollY) % this.tileSize;

    // Save color id of pixel x, y for bg/obj priority when rendering sprites
    this.bgColorId = this.getPixelColor(tile, tileX, tileY);

    let rgb = this.getColorRGB(this.bgColorId, this.BGP);
    this.drawPixel(x, y, rgb);
  }

  drawWindow(x, y) {
    // Check if x, y within window boundary
    if (x < this.winX || y < this.winY) {
      return;
    }
    // Window tilemap begins at 0x9800 or 9c000
    let base = this.LCDC & Constants.LCDC_WIN_TILEMAP ? 0x9c00 : 0x9800;

    let tileIndex = this.getTileAtCoords(x - this.winX, y - this.winY, base);
    let tile = this.getTileData(tileIndex);
    let tileX = (x - this.winX) % this.tileSize;
    let tileY = (y - this.winY) % this.tileSize;

    let colorId = this.getPixelColor(tile, tileX, tileY);
    let rgb = this.getColorRGB(colorId, this.BGP);
    this.drawPixel(x, y, rgb);
  }

  // Get color id of tile data at pixel x,y
  getPixelColor(tile, x, y) {

    // test tile from https://www.huderlem.com/demos/gameboy2bpp.html
    //tile = [0xFF, 0x00, 0x7E, 0xFF, 0x85, 0x81, 0x89, 0x83, 0x93, 0x85, 0xA5, 0x8B, 0xC9, 0x97, 0x7E, 0xFF]
    let left = tile[y * 2];
    let right = tile[(y * 2) + 1];
    let bit = 1 << 7 - x;
    let hi = right & bit ? 1 : 0;
    let lo = left & bit ? 1 : 0;
    return (hi << 1) + lo;
  }

  // Get sprite OAM data at (index)
  getSpriteOAM(index) {
    let oam = this.mmu.oam;
    let offset = index * 4;
    let flags = oam[offset + 3];
    return {
      y: oam[offset],
      x: oam[offset + 1],
      tileIndex: oam[offset + 2],
      bgPriority: flags & (1 << 7) ? true : false,
      flipY: flags & (1 << 6) ? true : false,
      flipX: flags & (1 << 5) ? true : false,
      obp: flags & (1 << 4) ? true : false,
      cgbVramBank: flags & (1 << 3) ? true : false,
      cgbPalette: flags & 0b11,
      oamAddress: offset,
    }
  }

  getSpriteData(spriteIndex) {
    let vram = this.mmu.vram;
    let index = 16 * spriteIndex;
    let end = this.spriteHeight * 2;
    for (let offset = 0; offset < end; offset++) {
      this.spriteData[offset] = vram[index + offset];
    }
    return this.spriteData;
  }

  getSpritesForLine(line) {
    let oam = this.mmu.oam;
    let sprites = [];

    for (let index = 0; index < 40; index++) {
      let spriteY = oam[index * 4] - 16; // sprite.y is vertical position on screen + 16
      if (spriteY <= line && spriteY + this.spriteHeight > line) {
        sprites.push(this.getSpriteOAM(index));
      }
      // Max 10 sprites per line
      if (sprites.length > 10) {
        break;
      }
    }
    return sprites;
    //return sprites.sort((a, b) => a < b || a.oamAddress < b.oamAddres);
  }

  drawSprites(x, y, bgColorId=0) {
    this.spriteHeight = this.LCDC & Constants.LCDC_OBJ_SIZE ? 16 : 8;

    for (let n = 0; n < this.sprites.length; n++) {
      let sprite = this.sprites[n];

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
        let colorId = this.getPixelColor(tile, tileX, tileY);

        // BG over obj priority
        if (sprite.bgPriority && bgColorId > 0) {
          continue;
        }
        // transparent pixel
        if (colorId == 0) {
          continue;
        }
        let rgb = this.getColorRGB(colorId, this.readByte(sprite.obp ? Constants.OBP1 : Constants.OBP0));
        this.drawPixel(x, y, rgb);
      }
    }
  }

  drawPixel(x, y, rgb) {
    let data = this.frameBuf.data;
    let offset = (y * Constants.VIEWPORT_WIDTH + x) * 4;

    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255; // alpha
  }
}
