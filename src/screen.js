// LCDScreen
class LCDScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvas.width = Constants.VIEWPORT_WIDTH;
    this.canvas.height = Constants.VIEWPORT_HEIGHT;
    this.ctx = canvas.getContext('2d');
  }

  // Draws the contents of PPU's frame buffer to an HTML canvas
  update(imageData) {
    this.ctx.putImageData(imageData, 0, 0, 0, 0, Constants.VIEWPORT_WIDTH, Constants.VIEWPORT_HEIGHT)
  }

  // Clear the screen
  reset() {
    this.ctx.fillStyle = 'rgb(' + Constants.DEFAULT_PALETTE[0].join(',') + ')';
    this.ctx.fillRect(0, 0, Constants.VIEWPORT_WIDTH, Constants.VIEWPORT_HEIGHT);
  }
}
