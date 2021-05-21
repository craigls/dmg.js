

class Console {
  constructor(canvas, height, width) {
    this.canvas = canvas;
    this.canvas.width = 500;
    this.canvas.height = 200;
    this.ctx = canvas.getContext('2d');
    this.ctx.font = '12px serif';
    this.ctx.fontColor = 'black';
    this.colWidth = 10;
    this.lineHeight = 12;
  }

  cpuFlagsToText(F) {
    return ((F & Z_FLAG) ? 'Z' : '-') + ((F & N_FLAG) ? 'N' : '-') + ((F & H_FLAG) ? 'H' : '-') + ((F & C_FLAG) ? 'C' : '-');
  }

  print(text, col, line) { 
    let x = (col * this.colWidth);
    let y = (line * this.lineHeight) + this.lineHeight;
    this.ctx.fillText(text, x, y);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
      
  update(dmg) {
    this.clear();
    this.updatePC(dmg);
    this.updateRegisters(dmg);
    this.updateCode(dmg);
  }

  updatePC(dmg) {
    this.print("PC=" + dmg.cpu.PC, 10, 5);
  }

  updateCode(dmg) {
    this.print("opcode=" + hexify(dmg.cpu.code || ''), 0, 6);
    this.print("cycles=" + dmg.cpu.totalCycles, 10, 6);
  }

  updateRegisters(dmg) { 
    this.print("A=" + dmg.cpu.A, 0, 1);
    this.print("B=" + dmg.cpu.B, 0, 2);
    this.print("C=" + dmg.cpu.C, 10, 2);
    this.print("D=" + dmg.cpu.D, 0, 3);
    this.print("E=" + dmg.cpu.E, 10, 3);
    this.print("H=" + dmg.cpu.H, 0, 4);
    this.print("L=" + dmg.cpu.L, 10, 4);
    this.print("F=" + this.cpuFlagsToText(dmg.cpu.F), 0, 5)
  }
}
