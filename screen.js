
class Screen {
  constructor(canvas, ppu) {
    this.canvas = canvas;
    this.ppu = ppu;
    this.canvas.width = VIEWPORT_WIDTH;
    this.canvas.height = VIEWPORT_HEIGHT;
    this.ctx = canvas.getContext('2d');

  }
  update(frameBuf) {
    this.ctx.putImageData(this.ppu.frameBuf, 0, 0, 0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
  }
}


  
  

