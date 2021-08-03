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

class PPU {
  constructor(mmu) {
    this.mmu = mmu;
    this.tileData = new Uint8Array(16);
    this.spriteData = new Uint8Array(32);
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
    this.frameBuf = new ImageData(Constants.FRAMEBUF_WIDTH, Constants.FRAMEBUF_HEIGHT);
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
    let stat = this.readByte(Constants.STAT_REG);
    stat &= ~(
        Constants.STAT_VBLANK_MODE
      | Constants.STAT_HBLANK_MODE
      | Constants.STAT_OAM_MODE
      | Constants.STAT_TRANSFER_MODE
    );
    this.writeByte(Constants.STAT_REG, stat | flag || 0);
  }

  evalStatInterrupt() {
    // Evaluate stat interrupt line
    let stat = this.readByte(Constants.STAT_REG);
    let interrupt = stat & Constants.STAT_LYCLY_EQUAL && stat & Constants.STAT_LYCLY_ON;
    interrupt ||= stat & Constants.STAT_OAM_MODE && stat & Constants.STAT_OAM_ON;
    interrupt ||= stat & Constants.STAT_VBLANK_MODE && stat & Constants.STAT_VBLANK_ON;
    interrupt ||= stat & Constants.STATS_HBLANK_MODE && stat & Constants.STAT_HBLANK_ON;

    if (interrupt) {
      // Interrupt line transitioning from low to high.
      this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) | Constants.IF_STAT);
    }
    else {
      this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) & ~Constants.IF_STAT);
    }
  }

  cycleStatMode() {
    let n = Math.floor(this.cycles / Constants.CYCLES_PER_FRAME) % 3;
    switch (n) {
      case 0:
        this.setStatMode(Constants.STAT_OAM_MODE);
        break;
      case 1:
        this.setStatMode(Constants.STAT_TRANSFER_MODE);
        break;
      case 2:
        this.setStatMode(Constants.STAT_HBLANK_MODE);
        break
    }
  }

  update(cycles) {
    this.cycles += cycles;
    this.spriteHeight = this.readByte(Constants.LCDC_REG) & Constants.LCDC_OBJ_SIZE ? 16 : 8;

    // LCD Disabled
    if (! this.readByte(Constants.LCDC_REG) & Constants.LCDC_ENABLE) {
      this.writeByte(Constants.LY_REG, 0);
      this.LCDEnabled = false;
      // TODO: clear screen
      return;
    }
    this.LCDEnabled = true;

    if (this.x >= Constants.FRAMEBUF_WIDTH) {
      this.x = 0;
      this.y++;
    }

    // Begin vblank at scanline 144
    if (this.y == 144) {
      this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) | Constants.IF_VBLANK);
      this.setStatMode(Constants.STAT_VBLANK_MODE);
      this.evalStatInterrupt();
    }

    // If not vblank: cycle LCD status modes
    else if (this.y < 144) {
      this.cycleStatMode();
      this.evalStatInterrupt();
    }

    // End of vblank
    else if (this.y == 154) {
      this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) & ~Constants.IF_VBLANK);
      this.y = 0;

      // Trigger screen redraw
      this.shouldUpdateScreen = true;
    }

    let sprites = this.getSpritesForLine(this.y);

    // Draw background pixels for n cycles
    if (this.y < Constants.FRAMEBUF_HEIGHT) {
      let end = this.x + cycles;
      while (this.x < Constants.FRAMEBUF_WIDTH) {
        this.drawBackground(this.x, this.y);
        this.drawSprites(sprites, this.x, this.y);
        this.x++;
        if (this.x == end) {
          break;
        }
      }
    }
    this.writeByte(Constants.LY_REG, this.y);

    // Check if STAT interrupt LYC=LY should be triggered
    if (this.readByte(Constants.LYC_REG) == this.y) {
      this.writeByte(Constants.STAT_REG, this.readByte(Constants.STAT_REG) | Constants.STAT_LYCLY_EQUAL);
      this.evalStatInterrupt();
    }
    else {
      this.writeByte(Constants.STAT_REG, this.readByte(Constants.STAT_REG) & ~Constants.STAT_LYCLY_EQUAL);
    }
  }

  getColorRGB(colorId, palette) {
    return Constants.DEFAULT_PALETTE[(palette >> (2 * colorId)) & 0b11];
  }

  getTileAtCoords(x, y) {
    // Finds the memory address of tile containing pixel at x, y
    let yTiles = Math.floor(y / Constants.TILE_SIZE) * Constants.BG_NUM_TILES;
    let xTiles = Math.floor(x / Constants.TILE_SIZE);

    // Get the offset for the tile address. Wraps back to zero if tileNum > 1023
    let tileNum = (xTiles + yTiles) % (Constants.BG_NUM_TILES * Constants.BG_NUM_TILES);

    // BG tilemap begins at 0x9800 or 9c000
    let base = (this.readByte(Constants.LCDC_REG) & Constants.LCDC_BG_TILEMAP) ? 0x9c00 : 0x9800;
    return this.readByte(base + tileNum);
  }

  getTileData(tileIndex) {
    // Get tile data for tile id
    // Each tile uses 16 bytes of memory

    // When bg/win flag is NOT set:
    //  tiles 0-127   -> address range 0x9000 - 0x97ff
    //  tiles 128-255 -> address range 0x8800 - 0x8fff
    let vram = this.mmu.vram;
    let index;

    if (this.readByte(Constants.LCDC_REG) & Constants.LCDC_BGWINDOW_TILEDATA) {
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

  drawBackground(x, y) {
    // Draws a single pixel of the BG tilemap for x, y
    let scrollX = this.readByte(Constants.SCROLLX_REG) % 255;
    let scrollY = this.readByte(Constants.SCROLLY_REG) % 255;

    let offsetX = scrollX % Constants.TILE_SIZE;
    let offsetY = scrollY % Constants.TILE_SIZE;

    let tileIndex = this.getTileAtCoords(x + scrollX, y + scrollY);
    let tile = this.getTileData(tileIndex);
    let tileX = (x + offsetX) % Constants.TILE_SIZE;
    let tileY = (y + offsetY) % Constants.TILE_SIZE;

    let colorId = this.getPixelColor(tile, tileX, tileY);
    let rgb = this.getColorRGB(colorId, this.readByte(Constants.BGP_REG));
    this.drawPixel(x, y, rgb);
  }

  getPixelColor(tile, tileX, tileY) {
    // Draws a single pixel of a tile at screen location x, y

    // test tile from https://www.huderlem.com/demos/gameboy2bpp.html
    //tile = [0xFF, 0x00, 0x7E, 0xFF, 0x85, 0x81, 0x89, 0x83, 0x93, 0x85, 0xA5, 0x8B, 0xC9, 0x97, 0x7E, 0xFF]
    let left = tile[tileY * 2];
    let right = tile[(tileY * 2) + 1];
    let bit = 1 << 7 - tileX;
    let hi = right & bit ? 1 : 0;
    let lo = left & bit ? 1 : 0;
    return (hi << 1) + lo;
  }

  getSpriteOAM(index) {
    let oam = this.mmu.oam;
    let offset = index * 4;
    let flags = oam[offset + 3];
    return {
      y: oam[offset],
      x: oam[offset + 1],
      tileIndex: oam[offset + 2],
      bgPriority: flags & (1 << 7) ? 1 : 0,
      flipY: flags & (1 << 6) ? 1 : 0,
      flipX: flags & (1 << 5) ? 1 : 0,
      obp: flags & (1 << 4) ? 1 : 0,
      cgbVramBank: flags & (1 << 3) ? 1 : 0,
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
        let colorId = this.getPixelColor(tile, tileX, tileY);
        if (colorId == 0) {
          continue; // transparent pixel
        }
        let rgb = this.getColorRGB(colorId, this.readByte(sprite.obp ? Constants.OBP1 : Constants.OBP0));
        this.drawPixel(x, y, rgb);
      }
    }
  }

  drawPixel(x, y, rgb) {
    let data = this.frameBuf.data;
    let offset = (y * Constants.FRAMEBUF_WIDTH + x) * 4;

    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255; // alpha
  }
}
