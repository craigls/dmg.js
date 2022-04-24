// CPU
class CPU {
  constructor(mmu, apu) {
    this.mmu = mmu;
    this.apu = apu;
    this.A = 0;
    this.B = 0;
    this.C = 0;
    this.D = 0;
    this.E = 0;
    this.F = 0;
    this.H = 0;
    this.L = 0;
    this.SP = 0;
    this.PC = 0;
    this.code = null
    this.cbcode = null;
    this.prevcode = null;
    this.totalCycles = 0;
    this.cycles = 0;
    this.IMEEnabled = false;
    this.haltMode = false;
    this.timerCycles = 0;

    this.flags = {
      Z: 128, // zero
      N: 64,  // subtraction
      H: 32,  // half carry
      C: 16,  // carry
    }

    // Lookup tables used when decoding certain instructions
    // https://gb-archive.github.io/salvage/decoding_gbz80_opcodes/Decoding%20Gamboy%20Z80%20Opcodes.html
    this.r = ["B", "C", "D", "E", "H", "L", null, "A"];
    this.rp = ["BC", "DE", "HL", "SP"];
    this.rp2 = ["BC", "DE", "HL", "AF"];

  }

  reset() {
    this.code = null;
    this.cbcode = null;
    this.prevcode = null;
    this.cycles = 0;
    this.totalCycles = 0;
    this.IMEEnabled = false;
    this.haltMode = false;
  }

  setFlag(f) {
    this.F |= this.flags[f];
  }

  clearFlag(f) {
    this.F &= ~this.flags[f];
  }

  getFlag(f) {
    if (this.flags[f] === undefined) { // sanity check
      throw new Error("Invalid flag! " + f);
    }
    return ((this.F & this.flags[f]) !== 0) ? true : false;
  }

  readByte(loc) {
    return this.mmu.readByte(loc);
  }

  writeByte(loc, value) {
    if (loc >= APU.rNR11 && loc <= APU.rNR41) {
      // Intercept writes to certain APU registers
      switch (loc) {
        case APU.rNR14:
        case APU.rNR24:
        case APU.rNR34:
        case APU.rNR44:
          // Sound is triggered when bit 7 set
          if (value & 0x80) {
            this.apu.triggerEvent(loc, value);
          }
          break;
        default:
          // do nothing
      }
    }
    return this.mmu.writeByte(loc, value);
  }

  nextByte() {
    return this.readByte(this.PC++);
  }

  // Decodes an opcode using the algorithm from:
  // https://gb-archive.github.io/salvage/decoding_gbz80_opcodes/Decoding%20Gamboy%20Z80%20Opcodes.html
  decode(code) {
    let x = (code & 0b11000000) >> 6;
    let y = (code & 0b00111000) >> 3;
    let z = (code & 0b00000111);
    let p = y >> 1;
    let q = y % 2;

    return {x: x, y: y, z: z, p: p, q: q};
  }

  read(param) {
    /*
     * d8  immediate 8-bit data
     * d16 immediate 16-bit data
     * a8  8-bit unsigned data + 0xff00
     * a16 16-bit address
     * s8  8-bit signed data
     */

    switch (param) {
      case "a8":
        return 0xff00 + this.nextByte();

      case "d16":
      case "a16":
        return this.nextByte() + (this.nextByte() << 8);

      case "d8":
        return this.nextByte();

      case "s8":
        return tcBin2Dec(this.nextByte());

      default:
        throw new Error("Unknown operand: " + param);
    }
  }

  popStack() {
    let lo = this.readByte(this.SP);
    this.SP++;
    let hi = this.readByte(this.SP);
    this.SP++;
    return uint16(hi, lo);
  }

  pushStack(val) {
    this.SP--;
    this.writeByte(this.SP, val >> 8);
    this.SP--;
    this.writeByte(this.SP, val & 0xff);
  }

  HL() {
    return uint16(this.H, this.L);
  }

  incHL() {
    [this.H, this.L] = this.INC16(this.H, this.L);
  }

  decHL() {
    [this.H, this.L] = this.DEC16(this.H, this.L);
  }

  // Push 2 bytes onto stack
  PUSH(hi, lo) {
    this.pushStack(uint16(hi, lo));
  }

  // Pop 2 bytes from stack
  POP() {
    let val = this.popStack();
    return [val >> 8, val & 0xff];
  }

  // Jump relative - no condition
  JR(offset) {
    let cycles = 12;
    this.PC += offset;
    return cycles;
  }

  // Jump relative if carry
  JRC(offset) {
    let cycles = 8;
    if (this.getFlag("C")) {
      this.PC += offset;
      cycles += 4;
    }
    return cycles;
  }

  // Jump relative if zero
  JRZ(offset) {
    let cycles = 8;
    if (this.getFlag("Z")) {
      this.PC += offset;
      cycles += 4;
    }
    return cycles;
  }

  // Jump relative if not zero
  JRNZ(offset) {
    let cycles = 8;
    if (! this.getFlag("Z")) {
      this.PC += offset;
      cycles += 4;
    }
    return cycles;
  }

  // Jump relative if not carry
  JRNC(offset) {
    let cycles = 8;
    if (! this.getFlag("C")) {
      this.PC += offset;
      cycles += 4;
    }
    return cycles;
  }

  // Jump to address
  JP(addr) {
    let cycles = 4;
    this.PC = addr;
    return cycles;
  }

  // Jump if zero
  JPZ(addr) {
    let cycles = 12;
    if (this.getFlag("Z")) {
      this.PC = addr;
      cycles += 4;
    }
    return cycles;
  }

  // Jump if not zero
  JPNZ(addr) {
    let cycles = 12;
    if (! this.getFlag("Z")) {
      this.PC = addr;
      cycles += 4;
    }
    return cycles;
  }

  // Jump if not carry
  JPNC(addr) {
    let cycles = 8;
    if (! this.getFlag("C")) {
      this.PC = addr;
      cycles += 4;
    }
    return cycles;
  }

  // Jump if carry
  JPC(addr) {
    let cycles = 8;
    if (this.getFlag("C")) {
      this.PC = addr;
      cycles += 4;
    }
    return cycles;
  }

  // Call function
  CALL(addr) {
    let cycles = 24;
    this.pushStack(this.PC);
    this.PC = addr;
    return cycles;
  }

  // Call if zero
  CALLZ(addr) {
    let cycles = 12;
    if (this.getFlag("Z")) {
      cycles = this.CALL(addr);
    }
    return cycles;
  }

  // Call if not zero
  CALLNZ(addr) {
    let cycles = 12;
    if (! this.getFlag("Z")) {
      cycles = this.CALL(addr);
    }
    return cycles;
  }

  // Call if carry
  CALLC(addr) {
    let cycles = 12;
    if (this.getFlag("C")) {
      cycles = this.CALL(addr);
    }
    return cycles;
  }

  // Call if not carry
  CALLNC(addr) {
    let cycles = 12;
    if (! this.getFlag("C")) {
      cycles = this.CALL(addr);
    }
    return cycles;
  }

  // Converts A register to BCD from previous add/sub op
  // More info at https://gbdev.gg8.se/wiki/articles/DAA
  DAA() {
    let n = this.A;
    if (this.getFlag("N")) {
      if (this.getFlag("C")) {
        n -= 0x60;
      }
      if (this.getFlag("H")) {
        n -= 0x06;
      }
    }
    else {
      if (this.getFlag("C") || (n & 0xff) > 0x99) {
        n += 0x60;
        this.setFlag("C");
      }
      if (this.getFlag("H") || (n & 0x0f) > 0x09) {
        n += 0x06;
      }
    }
    this.clearFlag("Z");
    if ((n & 0xff) === 0) {
      this.setFlag("Z");
    }
    this.clearFlag("H");
    return n & 0xff;
  }

  // Return
  RET() {
    let cycles = 16;
    this.PC = this.popStack();
    return cycles;
  }

  // Return from interrupt
  RETI() {
    this.IMEEnabled = true;
    this.PC = this.popStack();
  }

  // Return if zero
  RETZ() {
    let cycles = 8;
    if (this.getFlag("Z")) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Return if not zero
  RETNZ() {
    let cycles = 8;
    if (! this.getFlag("Z")) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Return if not carry
  RETNC() {
    let cycles = 8;
    if (! this.getFlag("C")) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Return if carry
  RETC() {
    let cycles = 8;
    if (this.getFlag("C")) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Enable interrupt
  EI() {
    this.IMEEnabled = true;
    this.cycles += 2;
  }

  // Disable interrupts
  DI() {
    this.IMEEnabled = false;
  }

  // Test if n-th bit is set
  BIT(bit, num) {
    this.clearFlag("N");
    this.setFlag("H");
    this.clearFlag("Z");

    // Set Z if bit NOT set
    if ((num & (1 << bit)) === 0) {
      this.setFlag("Z");
    }
    return num;
  }

  // Set n-th bit
  SET(bit, num) {
    return num | (1 << bit);
  }

  // Reset n-th bit
  RES(bit, num) {
    return num & ~(1 << bit);
  }

  // AND
  AND(n) {
    let val = this.A & n;

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("C");
    this.setFlag("H");

    if (val === 0) {
      this.setFlag("Z");
    }
    return val;
  }

  // OR
  OR(n) {
    let val = this.A | n;
    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if (val === 0) {
      this.setFlag("Z");
    }
    return val;
  }

  // XOR
  XOR(n) {
    let val = this.A ^ n;
    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    // Set Z == 0 if zero
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Rotate left, prev carry bit to bit 0
  RL(n) {
    let carry = this.getFlag("C");
    let rot = n << 1;

    // Previous carry is copied to bit zero
    if (carry) {
      rot |= 1;
    }
    else {
      rot &= ~1;
    }

    // Reset all flags
    this.clearFlag("C");
    this.clearFlag("N");
    this.clearFlag("Z");
    this.clearFlag("H");

    // Set C and Z from resulting rotation
    if (rot > 0xff) {
      this.setFlag("C");
    }
    if ((rot & 0xff) === 0) {
      this.setFlag("Z");
    }
    return rot & 0xff;
  }

  // Rotate A left, through carry flag. Prev carry to bit 0, clear zero flag
  RLA() {
    let bit7 = this.A & (1 << 7);
    let carry = this.getFlag("C");
    let rot = this.A << 1;

    // Reset all flags
    this.clearFlag("H");
    this.clearFlag("N");
    this.clearFlag("Z");
    this.clearFlag("C");

    if (bit7) {
      this.setFlag("C");
    }
    if (carry) {
      rot |= 1;
    }
    else {
      rot &= ~1;
    }
    return rot & 0xff;
  }

  // Rotate left: bit 7 to carry flag and bit 0
  RLC(n) {
    let bit7 = n & (1 << 7);
    let rot = n << 1;

    // Reset all
    this.clearFlag("H");
    this.clearFlag("N");
    this.clearFlag("Z");
    this.clearFlag("C");

    if (bit7) {
      this.setFlag("C");
      rot |= 1;
    }
    else {
      rot &= ~1;
    }
    if ((rot & 0xff) === 0) {
      this.setFlag("Z");
    }
    return rot & 0xff;
  }

  // RLCA - RLC applied to A register but zero flag is cleared
  RLCA() {
    let val = this.RLC(this.A);
    this.clearFlag("Z");
    return val;
  }

  // Shift right: bit 0 to carry, bit 7 reset to 0
  SRL(n) {
    let val = (n >> 1) & ~(1 << 7);
    let bit0 = n & (1 << 0);

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("C");
    this.clearFlag("H");

    if (bit0) {
      this.setFlag("C");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Shift right: bit 0 to carry flag, bit 7 unchanged
  SRA(n) {
    let bit0 = n & (1 << 0);
    let bit7 = n & (1 << 7);
    let val = n >> 1;

    if (bit7) {
      val |= (1 << 7);
    }
    else {
      val &= ~(1 << 7);
    }

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("C");
    this.clearFlag("H");

    if (bit0) {
      this.setFlag("C");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Shift left: bit 7 to carry, bit 0 reset to 0
  SLA(n) {
    let val = (n << 1) & ~(1 << 0)
    let bit7 = n & (1 << 7);

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("C");
    this.clearFlag("H");

    if (bit7) {
      this.setFlag("C");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Rotate right: prev carry to bit 7
  RR(n) {
    let carry = this.getFlag("C");
    let bit0 = n & (1 << 0);
    let rot = (n >> 1);

    if (carry) {
      rot |= (1 << 7);
    }
    else {
      rot &= ~(1 << 7);
    }

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if (bit0) {
      this.setFlag("C");
    }
    if ((rot & 0xff) === 0) {
      this.setFlag("Z");
    }
    return rot & 0xff;
  }

  // Rotate A right, through carry flag. Prev carry to bit 7, clear zero flag
  RRA() {
    let carry = this.getFlag("C");
    let bit0 = this.A & (1 << 0);
    let rot = this.A >> 1;

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if (carry) {
      rot |= (1 << 7);
    }
    else {
      rot &= ~(1 << 7);
    }
    if (bit0) {
      this.setFlag("C");
    }
    return rot & 0xff;
  }

  // Rotate right: bit 0 to carry flag and bit 7
  RRC(n) {
    let bit0 = (n & (1 << 0));
    let rot = n >> 1;

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if (bit0) {
      rot |= (1 << 7);
      this.setFlag("C");
    }
    else {
      rot &= ~(1 << 7);
    }
    if ((rot & 0xff) === 0) {
      this.setFlag("Z");
    }
    return rot & 0xff;
  }

  // Rotate A right: bit 0 to carry flag and bit 7
  RRCA() {
    let rot = this.RRC(this.A);
    this.clearFlag("Z");
    return rot;
  }

  // Increment
  INC(n) {
    let val = n + 1;

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");

    if (((n & 0xf) + 1) & 0x10) {
      this.setFlag("H");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Increment register pair
  INC16(hi, lo) {
    let val = uint16(hi, lo);
    val = ++val & 0xffff;
    return [val >> 8, val & 0xff];
  }

  // Decrement
  DEC(n) {
    let val = n - 1;
    this.setFlag("N");
    this.clearFlag("H");
    this.clearFlag("Z");

    if (((n & 0xf) - 1) & 0x10) {
      this.setFlag("H");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Decrement register pair
  DEC16(hi, lo) {
    let val = uint16(hi, lo);
    val = --val & 0xffff;
    return [val >> 8, val & 0xff];
  }

  // Addition of a + b + carry bit
  ADC(b) {
    let carry = this.getFlag("C") ? 1 : 0;
    let val = this.A + b + carry;

    this.clearFlag("Z");
    this.clearFlag("H");
    this.clearFlag("C");
    this.clearFlag("N");

    if (((this.A & 0xf) + (b & 0xf) + carry) & 0x10) {
      this.setFlag("H");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    if (val > 0xff) {
      this.setFlag("C");
    }
    return val & 0xff;

  }

  // Addition
  ADD(b) {
    let val = this.A + b;

    this.clearFlag("Z");
    this.clearFlag("H");
    this.clearFlag("C");
    this.clearFlag("N");

    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    if (val > 0xff) {
      this.setFlag("C");
    }
    if (((this.A & 0xf) + (b & 0xf)) & 0x10) {
      this.setFlag("H");
    }
    return val & 0xff;
  }

  // Add register pairs
  ADD16(a1, a2, b1, b2) {
    let a = uint16(a1, a2);
    let b = uint16(b1, b2);
    let val = a + b;

    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if (val > 0xffff) {
      this.setFlag("C");
    }
    if (((a & 0xfff) + (b & 0xfff)) & 0x1000) {
      this.setFlag("H");
    }
    return [(val >> 8) & 0xff, val & 0xff];
  }

  ADDSP(n) {
    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if (((this.SP & 0xf) + (n & 0xf)) & 0x10) {
      this.setFlag("H");
    }
    if (((this.SP & 0xff) + (n & 0xff)) & 0x100) { // TODO: Why does this work?
      this.setFlag("C");
    }
    return (this.SP + n) & 0xffff;
  }

  // Subtraction
  SUB(b) {
    let val = this.A - b;

    this.clearFlag("Z");
    this.clearFlag("H");
    this.clearFlag("C");
    this.setFlag("N");

    if (val < 0) {
      this.setFlag("C");
    }
    if (((this.A & 0xf) - (b & 0xf)) & 0x10) {
      this.setFlag("H");
    }
    if (this.A === b) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Subtraction: a - b - carry bit
  SBC(b) {
    let carry = this.getFlag("C") ? 1 : 0;
    let val = this.A - b - carry;

    this.clearFlag("Z");
    this.clearFlag("H");
    this.clearFlag("C");
    this.setFlag("N");

    if (val < 0) {
      this.setFlag("C");
    }
    if (((this.A & 0xf) - (b & 0xf) - carry) & 0x10) {
      this.setFlag("H");
    }
    if ((val & 0xff) === 0) {
      this.setFlag("Z");
    }
    return val & 0xff;
  }

  // Restart command - jump to preset address
  RST(loc) {
    this.pushStack(this.PC);
    this.PC = loc;
  }

  // Subtraction from A that sets flags without modifying A
  CP(n) {
    return this.SUB(n);
  }

  // Flip bits in A register, set N and H flags
  CPL() {
    this.setFlag("N");
    this.setFlag("H");
    return ~this.A & 0xff;
  }

  // Swap high/low nibbles
  SWAP(n) {
    let hi = (n & 0x0f) << 4;
    let lo = (n & 0xf0) >> 4;
    let result = hi | lo;

    this.clearFlag("Z");
    this.clearFlag("N");
    this.clearFlag("H");
    this.clearFlag("C");

    if ((result & 0xff) === 0) {
      this.setFlag("Z");
    }
    return result & 0xff;
  }

  // Clear carry flag
  CCF() {
    this.clearFlag("N");
    this.clearFlag("H");
    if (this.getFlag("C")) {
      this.clearFlag("C");
    }
    else {
      this.setFlag("C");
    }
  }

  // Set carry flag
  SCF() {
    this.clearFlag("N");
    this.clearFlag("H");
    this.setFlag("C");
  }

  nextInstruction() {
    // CPU is halted, don't do anything
    if (this.haltMode) {
      return;
    }
    this.execute(this.nextByte());
  }

  // Execute instructions
  execute(code) {
    let r1;
    let r2;
    let cbop;
    let addr;
    let op = this.decode(code);
    let val;

    this.code = code;
    this.cbcode = null;

    switch(code) {

      // 0x00  NOP  length: 1  cycles: 4  flags: ----  group: control/misc
      case 0x00:
        this.cycles += 4;
        break;

      // 0x01  LD BC,d16  length: 3  cycles: 12  flags: ----  group: x16/lsm
      case 0x01:
        this.C = this.nextByte();
        this.B = this.nextByte();
        this.cycles += 12;
        break;

      case 0x04: // 0x04  INC B  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x0c: // 0x0c  INC C  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x14: // 0x14  INC D  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x1c: // 0x1c  INC E  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x2c: // 0x2c  INC L  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x24: // 0x24  INC H  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x3c: // 0x3c  INC A  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
        r1 = this.r[op.y];
        this[r1] = this.INC(this[r1]);
        this.cycles += 4;
        break;

      // 0x09  ADD HL,BC  length: 1  cycles: 8  flags: -0HC  group: x16/alu
      case 0x09:
        [this.H, this.L] = this.ADD16(this.H, this.L, this.B, this.C);
        this.cycles += 8;
        break;

      // 0x19  ADD HL,DE  length: 1  cycles: 8  flags: -0HC  group: x16/alu
      case 0x19:
        [this.H, this.L] = this.ADD16(this.H, this.L, this.D, this.E);
        this.cycles += 8;
        break;

      // 0x29  ADD HL,HL  length: 1  cycles: 8  flags: -0HC  group: x16/alu
      case 0x29:
        [this.H, this.L] = this.ADD16(this.H, this.L, this.H, this.L);
        this.cycles += 8;
        break;

      case 0x0b: // 0x0b  DEC BC  length: 1  cycles: 8  flags: ----  group: x16/alu
        [this.B, this.C] = this.DEC16(this.B, this.C);
        this.cycles += 8;
        break;

      case 0x1b: // 0x1b  DEC DE  length: 1  cycles: 8  flags: ----  group: x16/alu
        [this.D, this.E] = this.DEC16(this.D, this.E);
        this.cycles += 8;
        break;

      case 0x2b: // 0x2b  DEC HL  length: 1  cycles: 8  flags: ----  group: x16/alu
        [this.H, this.L] = this.DEC16(this.H, this.L);
        this.cycles += 8;
        break;

      // 0x0f  RRCA  length: 1  cycles: 4  flags: 000C  group: x8/rsb
      case 0x0f:
        this.A = this.RRCA();
        this.cycles += 4;
        break;

      // 0x11  LD DE,d16  length: 3  cycles: 12  flags: ----  group: x16/lsm
      case 0x11:
        this.E = this.nextByte();
        this.D = this.nextByte();
        this.cycles += 12;
        break;

      // 0x1a  LD A,(DE)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x1a:
        this.A = this.readByte(uint16(this.D, this.E));
        this.cycles += 8;
        break;

      // 0x1f  RRA  length: 1  cycles: 4  flags: 000C  group: x8/rsb
      case 0x1f:
        this.A = this.RRA();
        this.cycles += 4;
        break;

      // 0x20  JR NZ,s8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x20:
        this.cycles += this.JRNZ(this.read("s8"));
        break;

      // 0x28  JR Z,s8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x28:
        this.cycles += this.JRZ(this.read("s8"));
        break;

      // 0x30  JR NC,s8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x30:
        this.cycles += this.JRNC(this.read("s8"));
        break;

      // 0x22  LD (HL+),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x22:
        this.writeByte(this.HL(), this.A);
        this.incHL();
        this.cycles += 8;
        break;

      // 0x2f  CPL  length: 1  cycles: 4  flags: -11-  group: x8/alu
      case 0x2f:
        this.A = this.CPL();
        this.cycles += 4;
        break;

      // 0xc3  JP a16  length: 3  cycles: 16  flags: ----  group: control/br
      case 0xc3:
        this.cycles += this.JP(this.read("a16"));
        break;

      // 0xcc  CALL Z,a16  length: 3  cycles: 24,12  flags: ----  group: control/br
      case 0xcc:
        this.cycles += this.CALLZ(this.read("a16"));
        break;

      // 0xcd  CALL a16  length: 3  cycles: 24  flags: ----  group: control/br
      case 0xcd:
        this.cycles += this.CALL(this.read("a16"));
        break;

      // 0xc4  CALL NZ,a16  length: 3  cycles: 24,12  flags: ----  group: control/br
      case 0xc4:
        this.cycles += this.CALLNZ(this.read("a16"));
        break;

      // 0xdc  CALL C,a16  length: 3  cycles: 24,12  flags: ----  group: control/br
      case 0xdc:
        this.cycles += this.CALLC(this.read("a16"));
        break;

      // 0xd4  CALL NC,a16  length: 3  cycles: 24,12  flags: ----  group: control/br
      case 0xd4:
        this.cycles += this.CALLNC(this.read("a16"));
        break;

      // 0xc6  ADD A,d8  length: 2  cycles: 8  flags: Z0HC  group: x8/alu
      case 0xc6:
        this.A = this.ADD(this.read("d8"));
        this.cycles += 8;
        break;

      // 0x4f  LD C,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x4f:
        this.C = this.A;
        this.cycles += 4;
        break;

      // 0x06  LD B,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x06:
        this.B = this.read("d8");
        this.cycles += 8;
        break;

      // 0x08  LD (a16),SP  length: 3  cycles: 20  flags: ----  group: x16/lsm
      case 0x08:
        addr = this.read("a16");
        this.writeByte(addr, this.SP & 0xff);
        this.writeByte(addr + 1, this.SP >> 8);
        this.cycles += 28;
        break;

      // 0x07  RLCA  length: 1  cycles: 4  flags: 000C  group: x8/rsb
      case 0x07:
        this.A = this.RLCA();
        this.cycles += 4;
        break;

      // 0xc1  POP BC  length: 1  cycles: 12  flags: ----  group: x16/lsm
      case 0xc1:
        [this.B, this.C] = this.POP();
        this.cycles += 12;
        break;

      // 0xc2  JP NZ,a16  length: 3  cycles: 16,12  flags: ----  group: control/br
      case 0xc2:
        this.cycles += this.JPNZ(this.read("a16"));
        break;

      // 0xd1  POP DE  length: 1  cycles: 12  flags: ----  group: x16/lsm
      case 0xd1:
        [this.D, this.E] = this.POP();
        this.cycles += 12;
        break;

      // 0xd2  JP NC,a16  length: 3  cycles: 16,12  flags: ----  group: control/br
      case 0xd2:
        this.cycles += this.JPNC(this.read("a16"));
        break;

      // 0xda  JP C,a16  length: 3  cycles: 16,12  flags: ----  group: control/br
      case 0xda:
        this.cycles += this.JPC(this.read("a16"));
        break;

      // 0xe1  POP HL  length: 1  cycles: 12  flags: ----  group: x16/lsm
      case 0xe1:
        [this.H, this.L] = this.POP();
        this.cycles += 12;
        break;

      // 0xe8  ADD SP,s8  length: 2  cycles: 16  flags: 00HC  group: x16/alu
      case 0xe8:
        this.SP = this.ADDSP(this.read("s8"));
        this.cycles += 16;
        break;

      // 0xf1  POP AF  length: 1  cycles: 12  flags: ZNHC  group: x16/lsm
      case 0xf1:
        [this.A, this.F] = this.POP();
        this.F &= 0xf0; // lower 4 bits are not used and should be cleared
        this.cycles += 12;
        break;

      // 0xee  XOR d8  length: 2  cycles: 8  flags: Z000  group: x8/alu
      case 0xee:
        this.A = this.XOR(this.read("d8"));
        this.cycles += 8;
        break;

      case 0xc7: // 0xc7  RST 00H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xcf: // 0xcf  RST 08H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xd7: // 0xd7  RST 10H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xdf: // 0xdf  RST 18H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xe7: // 0xe7  RST 20H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xef: // 0xef  RST 28H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xf7: // 0xf7  RST 30H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xff: // 0xff  RST 38H  length: 1  cycles: 16  flags: ----  group: control/br
        this.RST(op.y * 8);
        this.cycles += 16;
        break;

      // 0xf8  LD HL,SP+s8  length: 2  cycles: 12  flags: 00HC  group: x16/lsm
      case 0xf8:
        val = this.ADDSP(this.read("s8"));
        this.H = val >> 8;
        this.L = val & 0xff;
        this.cycles += 12;
        break;

      // 0xd0  RET NC  length: 1  cycles: 20,8  flags: ----  group: control/br
      case 0xd0:
        this.cycles += this.RETNC();
        break;

      // 0xd6  SUB d8  length: 2  cycles: 8  flags: Z1HC  group: x8/alu
      case 0xd6:
        this.A = this.SUB(this.read("d8"));
        this.cycles += 8;
        break;

      // 0xd8  RET C  length: 1  cycles: 20,8  flags: ----  group: control/br
      case 0xd8:
        this.cycles += this.RETC();
        break;

      // 0xd9  RETI  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xd9:
        this.RETI();
        this.cycles += 16;
        break;

      // 0xf3  DI  length: 1  cycles: 4  flags: ----  group: control/misc
      case 0xf3:
        this.DI();
        this.cycles += 4;
        break;

      // 0xf9  LD SP,HL  length: 1  cycles: 8  flags: ----  group: x16/lsm
      case 0xf9:
        this.SP = this.HL();
        this.cycles += 8;
        break;

      // 0xfe  CP d8  length: 2  cycles: 8  flags: Z1HC  group: x8/alu
      case 0xfe:
        this.CP(this.read("d8"));
        this.cycles += 8;
        break;

      // 0xca  JP Z,a16  length: 3  cycles: 16,12  flags: ----  group: control/br
      case 0xca:
        this.cycles += this.JPZ(this.read("a16"));
        break;

      case 0xc5: // 0xc5  PUSH BC  length: 1  cycles: 16  flags: ----  group: x16/lsm
        this.PUSH(this.B, this.C);
        this.cycles += 16;
        break;

      case 0xd5: // 0xd5  PUSH DE  length: 1  cycles: 16  flags: ----  group: x16/lsm
        this.PUSH(this.D, this.E);
        this.cycles += 16;
        break;

      case 0xe5: // 0xe5  PUSH HL  length: 1  cycles: 16  flags: ----  group: x16/lsm
        this.PUSH(this.H, this.L);
        this.cycles += 16;
        break;

      case 0xf5: // 0xf5  PUSH AF  length: 1  cycles: 16  flags: ----  group: x16/lsm
        this.PUSH(this.A, this.F);
        this.cycles += 16;
        break;

      // 0x02  LD (BC),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x02:
        this.writeByte(uint16(this.B, this.C), this.A);
        this.cycles += 8;
        break;

      case 0x3d: // 0x3d  DEC A  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x05: // 0x05  DEC B  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x0d: // 0x0d  DEC C  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x15: // 0x15  DEC D  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x1d: // 0x1d  DEC E  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x25: // 0x25  DEC H  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x2d: // 0x2d  DEC L  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
        r1 = this.r[op.y];
        this[r1] = this.DEC(this[r1]);
        this.cycles += 4;
        break;

      // 0x0e  LD C,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x0e:
        this.C = this.read("d8");
        this.cycles += 8;
        break;

      // 0x17  RLA  length: 1  cycles: 4  flags: 000C  group: x8/rsb
      case 0x17:
        this.A = this.RLA();
        this.cycles += 4;
        break;

      // 0x18  JR s8  length: 2  cycles: 12  flags: ----  group: control/br
      case 0x18:
        this.cycles += this.JR(this.read("s8"));
        break;

      case 0xa0: // 0xa0  AND B  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa1: // 0xa1  AND C  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa2: // 0xa2  AND D  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa3: // 0xa3  AND E  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa4: // 0xa4  AND H  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa5: // 0xa5  AND L  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa7: // 0xa7  AND A  length: 1  cycles: 4  flags: Z010  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.AND(this[r1]);
        this.cycles += 4;
        break;

      // 0xa6  AND (HL)  length: 1  cycles: 8  flags: Z010  group: x8/alu
      case 0xa6:
        this.A = this.AND(this.readByte(this.HL()));
        this.cycles += 8;
        break;

      // 0x0a  LD A,(BC)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x0a:
        this.A = this.readByte(uint16(this.B, this.C));
        this.cycles += 4;
        break;

      // 0xe2  LD (C),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0xe2:
        this.writeByte(0xff00 + this.C, this.A);
        this.cycles += 8;
        break;

      // 0xf2  LD A,(C)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0xf2:
        this.A = this.readByte(0xff00 + this.C);
        this.cycles += 8;
        break;

      // 0xe9  JP (HL)  length: 1  cycles: 4  flags: ----  group: control/br
      case 0xe9:
        this.cycles += this.JP(this.HL());
        break;

      // 0x31  LD SP,d16  length: 3  cycles: 12  flags: ----  group: x16/lsm
      case 0x31:
        this.SP = this.read("d16");
        this.cycles += 12;
        break;

      // 0x35  DEC (HL)  length: 1  cycles: 12  flags: Z1H-  group: x8/alu
      case 0x35:
        this.writeByte(this.HL(), this.DEC(this.readByte(this.HL())));
        this.cycles += 12;
        break;

      // 0x36  LD (HL),d8  length: 2  cycles: 12  flags: ----  group: x8/lsm
      case 0x36:
        this.writeByte(this.HL(), this.read("d8"));
        this.cycles += 12;
        break;

      // 0x37  SCF  length: 1  cycles: 4  flags: -001  group: x8/alu
      case 0x37:
        this.SCF();
        this.cycles += 4;
        break;

      case 0xa8: // 0xa8  XOR B  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xa9: // 0xa9  XOR C  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xaa: // 0xaa  XOR D  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xab: // 0xab  XOR E  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xac: // 0xac  XOR H  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xad: // 0xad  XOR L  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xaf: // 0xaf  XOR A  length: 1  cycles: 4  flags: Z000  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.XOR(this[r1]);
        this.cycles += 4;
        break;

      // 0xae  XOR (HL)  length: 1  cycles: 8  flags: Z000  group: x8/alu
      case 0xae:
        this.A = this.XOR(this.readByte(this.HL()));
        this.cycles += 8;
        break;

      case 0xb0: // 0xb0  OR B  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb1: // 0xb1  OR C  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb2: // 0xb2  OR D  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb3: // 0xb3  OR E  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb4: // 0xb4  OR H  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb5: // 0xb5  OR L  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb7: // 0xb7  OR A  length: 1  cycles: 4  flags: Z000  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.OR(this[r1]);
        this.cycles += 4;
        break;

      // 0xb6  OR (HL)  length: 1  cycles: 8  flags: Z000  group: x8/alu
      case 0xb6:
        this.A = this.OR(this.readByte(this.HL()));
        this.cycles += 8;
        break;

      // 0xf6  OR d8  length: 2  cycles: 8  flags: Z000  group: x8/alu
      case 0xf6:
        this.A = this.OR(this.read("d8"));
        this.cycles += 8;
        break;

      case 0xb8: // 0xb8  CP B  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xb9: // 0xb9  CP C  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xba: // 0xba  CP D  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xbb: // 0xbb  CP E  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xbc: // 0xbc  CP H  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xbd: // 0xbd  CP L  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xbf: // 0xbf  CP A  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
        r1 = this.r[op.z];
        this.CP(this[r1]);
        this.cycles += 4;
        break;

      // 0xc0  RET NZ  length: 1  cycles: 20,8  flags: ----  group: control/br
      case 0xc0:
        this.cycles += this.RETNZ();
        break;

      // 0xc8  RET Z  length: 1  cycles: 20,8  flags: ----  group: control/br
      case 0xc8:
        this.cycles += this.RETZ();
        break;

      // 0xc9  RET  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xc9:
        this.cycles += this.RET();
        break;

      case 0xce: // 0xce  ADC A,d8  length: 2  cycles: 8  flags: Z0HC  group: x8/alu
        this.A = this.ADC(this.read("d8"));
        this.cycles += 8;
        break;

      // 0x8e  ADC A,(HL)  length: 1  cycles: 8  flags: Z0HC  group: x8/alu
      case 0x8e:
        this.A = this.ADC(this.readByte(this.HL()));
        this.cycles += 4;
        break;

      // 0xfb  EI  length: 1  cycles: 4  flags: ----  group: control/misc
      case 0xfb:
        this.EI();
        this.cycles += 4;
        break;

      // 0x16  LD D,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x16:
        this.D = this.read("d8");
        this.cycles += 8;
        break;

      // 0xbe  CP (HL)  length: 1  cycles: 8  flags: Z1HC  group: x8/alu
      case 0xbe:
        this.CP(this.readByte(this.HL()));
        this.cycles += 8;
        break;

      // 0x21  LD HL,d16  length: 3  cycles: 12  flags: ----  group: x16/lsm
      case 0x21:
        this.L = this.nextByte();
        this.H = this.nextByte();
        this.cycles += 12;
        break;

      // 0x26  LD H,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x26:
        this.H = this.read("d8");
        this.cycles += 8;
        break;

      // 0x2a  LD A,(HL+)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x2a:
        this.A = this.readByte(this.HL());
        this.incHL();
        this.cycles += 8;
        break;

      // 0xfa  LD A,(a16)  length: 3  cycles: 16  flags: ----  group: x8/lsm
      case 0xfa:
        this.A = this.readByte(this.read("a16"));
        this.cycles += 16;
        break;

      // 0x2e  LD L,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x2e:
        this.L = this.read("d8");
        this.cycles += 8;
        break;

      // 0x32  LD (HL-),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x32:
        this.writeByte(this.HL(), this.A);
        this.decHL();
        this.cycles += 8;
        break;

      // 0x33  INC SP  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x33:
        this.SP = ++this.SP & 0xffff;
        this.cycles += 8;
        break;

      // 0x3b  DEC SP  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x3b:
        this.SP = --this.SP & 0xffff;
        this.cycles += 8;
        break;

      // 0x39  ADD HL,SP  length: 1  cycles: 8  flags: -0HC  group: x16/alu
      case 0x39:
        [this.H, this.L] = this.ADD16(this.H, this.L, this.SP >> 8, this.SP & 0xff);
        this.cycles += 8;
        break;

      // 0x3a  LD A,(HL-)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x3a:
        this.A = this.readByte(this.HL());
        this.decHL();
        this.cycles += 8;
        break;

      // 0x3e  LD A,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x3e:
        this.A = this.read("d8");
        this.cycles += 8;
        break;

      // 0x3f  CCF  length: 1  cycles: 4  flags: -00C  group: x8/alu
      case 0x3f:
        this.CCF();
        this.cycles += 4;
        break;

      // 0x76  HALT  length: 1  cycles: 4  flags: ----  group: control/misc
      case 0x76:
        this.haltMode = !this.IMEEnabled;
        this.cycles += 4;
        break;

      case 0x40: // 0x40  LD B,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x41: // 0x41  LD B,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x42: // 0x42  LD B,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x43: // 0x43  LD B,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x44: // 0x44  LD B,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x45: // 0x45  LD B,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x47: // 0x47  LD B,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x48: // 0x48  LD C,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x49: // 0x49  LD C,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x4a: // 0x4a  LD C,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x4b: // 0x4b  LD C,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x4c: // 0x4c  LD C,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x4d: // 0x4d  LD C,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x50: // 0x50  LD D,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x51: // 0x51  LD D,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x52: // 0x52  LD D,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x53: // 0x53  LD D,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x54: // 0x54  LD D,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x55: // 0x55  LD D,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x57: // 0x57  LD D,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x58: // 0x58  LD E,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x59: // 0x59  LD E,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5a: // 0x5a  LD E,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5b: // 0x5b  LD E,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5c: // 0x5c  LD E,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5d: // 0x5d  LD E,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5f: // 0x5f  LD E,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x60: // 0x60  LD H,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x61: // 0x61  LD H,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x62: // 0x62  LD H,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x63: // 0x63  LD H,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x64: // 0x64  LD H,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x65: // 0x65  LD H,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x67: // 0x67  LD H,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x68: // 0x68  LD L,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x69: // 0x69  LD L,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x6a: // 0x6a  LD L,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x6b: // 0x6b  LD L,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x6c: // 0x6c  LD L,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x6d: // 0x6d  LD L,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x6f: // 0x6f  LD L,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x78: // 0x78  LD A,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x79: // 0x79  LD A,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7a: // 0x7a  LD A,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7b: // 0x7b  LD A,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7c: // 0x7c  LD A,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7d: // 0x7d  LD A,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7f: // 0x7f  LD A,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
        r1 = this.r[op.y];
        r2 = this.r[op.z];
        this[r1] = this[r2];
        this.cycles += 4;
        break;

      case 0x46: // 0x46  LD B,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x4e: // 0x4e  LD C,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x56: // 0x56  LD D,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x5e: // 0x5e  LD E,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x66: // 0x66  LD H,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x6e: // 0x6e  LD L,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x7e: // 0x7e  LD A,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
        r1 = this.r[op.y];
        this[r1] = this.readByte(this.HL());
        this.cycles += 8;
        break;

      case 0x70: // 0x70  LD (HL),B  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x71: // 0x71  LD (HL),C  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x72: // 0x72  LD (HL),D  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x73: // 0x73  LD (HL),E  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x74: // 0x74  LD (HL),H  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x75: // 0x75  LD (HL),L  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x77: // 0x77  LD (HL),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
        r1 = this.r[op.z];
        this.writeByte(this.HL(), this[r1]);
        this.cycles += 8;
        break;

      case 0x80: // 0x80  ADD A,B  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x81: // 0x81  ADD A,C  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x82: // 0x82  ADD A,D  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x83: // 0x83  ADD A,E  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x84: // 0x84  ADD A,H  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x85: // 0x85  ADD A,L  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x87: // 0x87  ADD A,A  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.ADD(this[r1]);
        this.cycles += 8;
        break;

      // 0x86  ADD A,(HL)  length: 1  cycles: 8  flags: Z0HC  group: x8/alu
      case 0x86:
        this.A = this.ADD(this.readByte(this.HL()));
        this.cycles += 8;
        break;

      case 0x88: // 0x88  ADC A,B  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x89: // 0x89  ADC A,C  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x8a: // 0x8a  ADC A,D  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x8b: // 0x8b  ADC A,E  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x8d: // 0x8d  ADC A,L  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x8f: // 0x8f  ADC A,A  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x8c: // 0x8c  ADC A,H  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.ADC(this[r1]);
        this.cycles += 4;
        break;

      case 0x90: // 0x90  SUB B  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x91: // 0x91  SUB C  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x92: // 0x92  SUB D  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x93: // 0x93  SUB E  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x94: // 0x94  SUB H  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x95: // 0x95  SUB L  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x97: // 0x97  SUB A  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.SUB(this[r1]);
        this.cycles += 4;
        break;

      // 0x96  SUB (HL)  length: 1  cycles: 8  flags: Z1HC  group: x8/alu
      case 0x96:
        this.A = this.SUB(this.readByte(this.HL()));
        this.cycles += 4;
        break;

      case 0x98: // 0x98  SBC A,B  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x99: // 0x99  SBC A,C  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x9a: // 0x9a  SBC A,D  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x9b: // 0x9b  SBC A,E  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x9c: // 0x9c  SBC A,H  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x9d: // 0x9d  SBC A,L  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x9f: // 0x9f  SBC A,A  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
        r1 = this.r[op.z];
        this.A = this.SBC(this[r1]);
        this.cycles += 4;
        break;

      case 0x9e: // 0x9e  SBC A,(HL)  length: 1  cycles: 8  flags: Z1HC  group: x8/alu
        this.A = this.SBC(this.readByte(this.HL()));
        this.cycles += 8;
        break;

      // 0xde  SBC A,d8  length: 2  cycles: 8  flags: Z1HC  group: x8/alu
      case 0xde:
        this.A = this.SBC(this.read("d8"));
        this.cycles += 8;
        break;

      // 0xe0  LDH (a8),A  length: 2  cycles: 12  flags: ----  group: x8/lsm
      case 0xe0:
        this.writeByte(this.read("a8"), this.A);
        this.cycles += 12;
        break;

      // 0xe6  AND d8  length: 2  cycles: 8  flags: Z010  group: x8/alu
      case 0xe6:
        this.A = this.AND(this.read("d8"));
        this.cycles += 8;
        break;

      // 0xf0  LDH A,(a8)  length: 2  cycles: 12  flags: ----  group: x8/lsm
      case 0xf0:
        this.A = this.readByte(this.read("a8"));
        this.cycles += 12;
        break;

      // 0xea  LD (a16),A  length: 3  cycles: 16  flags: ----  group: x8/lsm
      case 0xea:
        this.writeByte(this.read("a16"), this.A);
        this.cycles += 16;
        break;

      // 0x12  LD (DE),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x12:
        this.writeByte(uint16(this.D, this.E), this.A);
        this.cycles += 8;
        break;

      // 0x1e  LD E,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x1e:
        this.E = this.read("d8");
        this.cycles += 8;
        break;

      case 0x03: // 0x03  INC BC  length: 1  cycles: 8  flags: ----  group: x16/alu
        [this.B, this.C] = this.INC16(this.B, this.C);
        this.cycles += 8;
        break;

      case 0x23: // 0x23  INC HL  length: 1  cycles: 8  flags: ----  group: x16/alu
        [this.H, this.L] = this.INC16(this.H, this.L);
        this.cycles += 8;
        break;

      case 0x13: // 0x13  INC DE  length: 1  cycles: 8  flags: ----  group: x16/alu
        [this.D, this.E] = this.INC16(this.D, this.E);
        this.cycles += 8;
        break;

      // 0x27  DAA  length: 1  cycles: 4  flags: Z-0C  group: x8/alu
      case 0x27:
        this.A = this.DAA();
        this.cycles += 4;
        break;

      // 0x34  INC (HL)  length: 1  cycles: 12  flags: Z0H-  group: x8/alu
      case 0x34:
        this.writeByte(this.HL(), this.INC(this.readByte(this.HL())));
        this.cycles += 12;
        break;

      // 0x38  JR C,s8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x38:
        this.cycles += this.JRC(this.read("s8"));
        break;

      // cb prefixes
      case 0xcb:

        // Get the actual cbcode
        this.cbcode = this.nextByte();
        cbop = this.decode(this.cbcode);

        switch(this.cbcode) {

          case 0x00: // (cb) 0x00  RLC B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x01: // (cb) 0x01  RLC C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x02: // (cb) 0x02  RLC D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x03: // (cb) 0x03  RLC E  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x04: // (cb) 0x04  RLC H  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x05: // (cb) 0x05  RLC L  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x07: // (cb) 0x07  RLC A  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.RLC(this[r1]);
            this.cycles += 8;
            break;

          case 0x06: // (cb) 0x06  RLC (HL)  length: 2  cycles: 16  flags: Z00C  group: x8/rsb
            this.writeByte(this.HL(), this.RLC(this.readByte(this.HL())));
            this.cycles += 8;
            break;

          case 0x08: // (cb) 0x08  RRC B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x09: // (cb) 0x09  RRC C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x0a: // (cb) 0x0a  RRC D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x0b: // (cb) 0x0b  RRC E  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x0c: // (cb) 0x0c  RRC H  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x0d: // (cb) 0x0d  RRC L  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x0f: // (cb) 0x0f  RRC A  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.RRC(this[r1]);
            this.cycles += 8;
            break;

          case 0x0e: // (cb) 0x0e  RRC (HL)  length: 2  cycles: 16  flags: Z00C  group: x8/rsb
            this.writeByte(this.HL(), this.RRC(this.readByte(this.HL())));
            this.cycles += 16;
            break;

          case 0x10: // (cb) 0x10  RL B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x11: // (cb) 0x11  RL C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x12: // (cb) 0x12  RL D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x13: // (cb) 0x13  RL E  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x14: // (cb) 0x14  RL H  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x15: // (cb) 0x15  RL L  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x17: // (cb) 0x17  RL A  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.RL(this[r1]);
            this.cycles += 8;
            break;

          // (cb) 0x16  RL (HL)  length: 2  cycles: 16  flags: Z00C  group: x8/rsb
          case 0x16:
            this.writeByte(this.HL(), this.RL(this.readByte(this.HL())));
            this.cycles += 16;
            break;

          case 0x18: // (cb) 0x18  RR B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x19: // (cb) 0x19  RR C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x1a: // (cb) 0x1a  RR D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x1b: // (cb) 0x1b  RR E  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x1c: // (cb) 0x1c  RR H  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x1d: // (cb) 0x1d  RR L  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x1f: // (cb) 0x1f  RR A  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.RR(this[r1]);
            this.cycles += 8;
            break;


          case 0x1e: // (cb) 0x1e  RR (HL)  length: 2  cycles: 16  flags: Z00C  group: x8/rsb
            this.writeByte(this.HL(), this.RR(this.readByte(this.HL())));
            this.cycles += 16;
            break;

          case 0x20: // (cb) 0x20  SLA B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x21: // (cb) 0x21  SLA C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x22: // (cb) 0x22  SLA D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x23: // (cb) 0x23  SLA E  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x24: // (cb) 0x24  SLA H  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x25: // (cb) 0x25  SLA L  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x27: // (cb) 0x27  SLA A  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.SLA(this[r1]);
            this.cycles += 8;
            break;

          // (cb) 0x26  SLA (HL)  length: 2  cycles: 16  flags: Z00C  group: x8/rsb
          case 0x26:
            this.writeByte(this.HL(), this.SLA(this.readByte(this.HL())));
            this.cycles += 8;
            break;

          case 0x2f: // (cb) 0x2f  SRA A  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x28: // (cb) 0x28  SRA B  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x29: // (cb) 0x29  SRA C  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x2a: // (cb) 0x2a  SRA D  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x2b: // (cb) 0x2b  SRA E  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x2c: // (cb) 0x2c  SRA H  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x2d: // (cb) 0x2d  SRA L  length: 2  cycles: 8  flags: Z000  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.SRA(this[r1]);
            this.cycles += 8;
            break;

          // (cb) 0x2e  SRA (HL)  length: 2  cycles: 16  flags: Z000  group: x8/rsb
          case 0x2e:
            this.writeByte(this.HL(), this.SRA(this.readByte(this.HL())));
            this.cycles += 16;
            break;

          case 0x40: // (cb) 0x40  BIT 0,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x41: // (cb) 0x41  BIT 0,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x42: // (cb) 0x42  BIT 0,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x43: // (cb) 0x43  BIT 0,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x44: // (cb) 0x44  BIT 0,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x45: // (cb) 0x45  BIT 0,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x47: // (cb) 0x47  BIT 0,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x48: // (cb) 0x48  BIT 1,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x49: // (cb) 0x49  BIT 1,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x4a: // (cb) 0x4a  BIT 1,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x4b: // (cb) 0x4b  BIT 1,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x4c: // (cb) 0x4c  BIT 1,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x4d: // (cb) 0x4d  BIT 1,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x4f: // (cb) 0x4f  BIT 1,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x50: // (cb) 0x50  BIT 2,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x51: // (cb) 0x51  BIT 2,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x52: // (cb) 0x52  BIT 2,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x53: // (cb) 0x53  BIT 2,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x54: // (cb) 0x54  BIT 2,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x55: // (cb) 0x55  BIT 2,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x57: // (cb) 0x57  BIT 2,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x58: // (cb) 0x58  BIT 3,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x59: // (cb) 0x59  BIT 3,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x5a: // (cb) 0x5a  BIT 3,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x5b: // (cb) 0x5b  BIT 3,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x5c: // (cb) 0x5c  BIT 3,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x5d: // (cb) 0x5d  BIT 3,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x5f: // (cb) 0x5f  BIT 3,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x60: // (cb) 0x60  BIT 4,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x61: // (cb) 0x61  BIT 4,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x62: // (cb) 0x62  BIT 4,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x63: // (cb) 0x63  BIT 4,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x64: // (cb) 0x64  BIT 4,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x65: // (cb) 0x65  BIT 4,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x67: // (cb) 0x67  BIT 4,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x68: // (cb) 0x68  BIT 5,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x69: // (cb) 0x69  BIT 5,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x6a: // (cb) 0x6a  BIT 5,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x6b: // (cb) 0x6b  BIT 5,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x6c: // (cb) 0x6c  BIT 5,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x6d: // (cb) 0x6d  BIT 5,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x6f: // (cb) 0x6f  BIT 5,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x70: // (cb) 0x70  BIT 6,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x71: // (cb) 0x71  BIT 6,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x72: // (cb) 0x72  BIT 6,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x73: // (cb) 0x73  BIT 6,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x74: // (cb) 0x74  BIT 6,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x75: // (cb) 0x75  BIT 6,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x77: // (cb) 0x77  BIT 6,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x78: // (cb) 0x78  BIT 7,B  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x79: // (cb) 0x79  BIT 7,C  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x7a: // (cb) 0x7a  BIT 7,D  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x7b: // (cb) 0x7b  BIT 7,E  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x7c: // (cb) 0x7c  BIT 7,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x7d: // (cb) 0x7d  BIT 7,L  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x7f: // (cb) 0x7f  BIT 7,A  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
            r1 = this.r[cbop.z];
            this.BIT(cbop.y, this[r1]);
            this.cycles += 8;
            break;

          case 0x46: // (cb) 0x46  BIT 0,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x4e: // (cb) 0x4e  BIT 1,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x56: // (cb) 0x56  BIT 2,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x5e: // (cb) 0x5e  BIT 3,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x66: // (cb) 0x66  BIT 4,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x6e: // (cb) 0x6e  BIT 5,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x76: // (cb) 0x76  BIT 6,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
          case 0x7e: // (cb) 0x7e  BIT 7,(HL)  length: 2  cycles: 16  flags: Z01-  group: x8/rsb
            this.BIT(cbop.y, this.readByte(this.HL()));
            this.cycles += 16;
            break;

          case 0x30: // (cb) 0x30  SWAP B  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x31: // (cb) 0x31  SWAP C  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x32: // (cb) 0x32  SWAP D  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x33: // (cb) 0x33  SWAP E  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x34: // (cb) 0x34  SWAP H  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x35: // (cb) 0x35  SWAP L  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x37: // (cb) 0x37  SWAP A  length: 2  cycles: 8  flags: Z000  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.SWAP(this[r1]);
            this.cycles += 8;
            break;

          // (cb) 0x36  SWAP (HL)  length: 2  cycles: 16  flags: Z000  group: x8/rsb
          case 0x36:
            this.writeByte(this.HL(), this.SWAP(this.readByte(this.HL())));
            this.cycles += 16;
            break;

          case 0x38: // (cb) 0x38  SRL B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x39: // (cb) 0x39  SRL C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x3a: // (cb) 0x3a  SRL D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x3b: // (cb) 0x3b  SRL E  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x3c: // (cb) 0x3c  SRL H  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x3d: // (cb) 0x3d  SRL L  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x3f: // (cb) 0x3f  SRL A  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.SRL(this[r1]);
            this.cycles += 8;
            break;

          case 0x3e: // (cb) 0x3e  SRL (HL)  length: 2  cycles: 16  flags: Z00C  group: x8/rsb
            this.writeByte(this.HL(), this.SRL(this.readByte(this.HL())));
            this.cycles += 8;
            break;

          case 0x80: // (cb) 0x80  RES 0,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x81: // (cb) 0x81  RES 0,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x82: // (cb) 0x82  RES 0,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x83: // (cb) 0x83  RES 0,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x84: // (cb) 0x84  RES 0,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x85: // (cb) 0x85  RES 0,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x87: // (cb) 0x87  RES 0,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x88: // (cb) 0x88  RES 1,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x89: // (cb) 0x89  RES 1,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x8a: // (cb) 0x8a  RES 1,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x8b: // (cb) 0x8b  RES 1,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x8c: // (cb) 0x8c  RES 1,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x8d: // (cb) 0x8d  RES 1,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x8f: // (cb) 0x8f  RES 1,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x90: // (cb) 0x90  RES 2,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x91: // (cb) 0x91  RES 2,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x92: // (cb) 0x92  RES 2,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x93: // (cb) 0x93  RES 2,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x94: // (cb) 0x94  RES 2,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x95: // (cb) 0x95  RES 2,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x97: // (cb) 0x97  RES 2,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x98: // (cb) 0x98  RES 3,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x99: // (cb) 0x99  RES 3,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x9a: // (cb) 0x9a  RES 3,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x9b: // (cb) 0x9b  RES 3,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x9c: // (cb) 0x9c  RES 3,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x9d: // (cb) 0x9d  RES 3,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0x9f: // (cb) 0x9f  RES 3,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa0: // (cb) 0xa0  RES 4,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa1: // (cb) 0xa1  RES 4,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa2: // (cb) 0xa2  RES 4,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa3: // (cb) 0xa3  RES 4,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa4: // (cb) 0xa4  RES 4,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa5: // (cb) 0xa5  RES 4,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa7: // (cb) 0xa7  RES 4,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa8: // (cb) 0xa8  RES 5,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xa9: // (cb) 0xa9  RES 5,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xaa: // (cb) 0xaa  RES 5,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xab: // (cb) 0xab  RES 5,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xac: // (cb) 0xac  RES 5,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xad: // (cb) 0xad  RES 5,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xaf: // (cb) 0xaf  RES 5,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb0: // (cb) 0xb0  RES 6,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb1: // (cb) 0xb1  RES 6,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb2: // (cb) 0xb2  RES 6,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb3: // (cb) 0xb3  RES 6,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb4: // (cb) 0xb4  RES 6,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb5: // (cb) 0xb5  RES 6,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb7: // (cb) 0xb7  RES 6,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb8: // (cb) 0xb8  RES 7,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xb9: // (cb) 0xb9  RES 7,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xba: // (cb) 0xba  RES 7,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xbb: // (cb) 0xbb  RES 7,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xbc: // (cb) 0xbc  RES 7,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xbd: // (cb) 0xbd  RES 7,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xbf: // (cb) 0xbf  RES 7,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.RES(cbop.y, this[r1]);
            this.cycles += 8;
            break

          case 0x86: // (cb) 0x86  RES 0,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0x8e: // (cb) 0x8e  RES 1,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0x96: // (cb) 0x96  RES 2,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0x9e: // (cb) 0x9e  RES 3,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xa6: // (cb) 0xa6  RES 4,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xae: // (cb) 0xae  RES 5,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xb6: // (cb) 0xb6  RES 6,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xbe: // (cb) 0xbe  RES 7,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
            this.writeByte(this.HL(), this.RES(cbop.y, this.readByte(this.HL())));
            this.cycles += 16;
            break;

          case 0xc0: // (cb) 0xc0  SET 0,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc1: // (cb) 0xc1  SET 0,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc2: // (cb) 0xc2  SET 0,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc3: // (cb) 0xc3  SET 0,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc4: // (cb) 0xc4  SET 0,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc5: // (cb) 0xc5  SET 0,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc7: // (cb) 0xc7  SET 0,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc8: // (cb) 0xc8  SET 1,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xc9: // (cb) 0xc9  SET 1,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xca: // (cb) 0xca  SET 1,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xcb: // (cb) 0xcb  SET 1,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xcc: // (cb) 0xcc  SET 1,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xcd: // (cb) 0xcd  SET 1,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xcf: // (cb) 0xcf  SET 1,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd0: // (cb) 0xd0  SET 2,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd1: // (cb) 0xd1  SET 2,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd2: // (cb) 0xd2  SET 2,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd3: // (cb) 0xd3  SET 2,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd4: // (cb) 0xd4  SET 2,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd5: // (cb) 0xd5  SET 2,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd7: // (cb) 0xd7  SET 2,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd8: // (cb) 0xd8  SET 3,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xd9: // (cb) 0xd9  SET 3,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xda: // (cb) 0xda  SET 3,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xdb: // (cb) 0xdb  SET 3,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xdc: // (cb) 0xdc  SET 3,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xdd: // (cb) 0xdd  SET 3,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xdf: // (cb) 0xdf  SET 3,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe0: // (cb) 0xe0  SET 4,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe1: // (cb) 0xe1  SET 4,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe2: // (cb) 0xe2  SET 4,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe3: // (cb) 0xe3  SET 4,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe4: // (cb) 0xe4  SET 4,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe5: // (cb) 0xe5  SET 4,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe7: // (cb) 0xe7  SET 4,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe8: // (cb) 0xe8  SET 5,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xe9: // (cb) 0xe9  SET 5,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xea: // (cb) 0xea  SET 5,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xeb: // (cb) 0xeb  SET 5,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xec: // (cb) 0xec  SET 5,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xed: // (cb) 0xed  SET 5,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xef: // (cb) 0xef  SET 5,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf0: // (cb) 0xf0  SET 6,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf1: // (cb) 0xf1  SET 6,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf2: // (cb) 0xf2  SET 6,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf3: // (cb) 0xf3  SET 6,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf4: // (cb) 0xf4  SET 6,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf5: // (cb) 0xf5  SET 6,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf7: // (cb) 0xf7  SET 6,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf8: // (cb) 0xf8  SET 7,B  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xf9: // (cb) 0xf9  SET 7,C  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xfa: // (cb) 0xfa  SET 7,D  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xfb: // (cb) 0xfb  SET 7,E  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xfc: // (cb) 0xfc  SET 7,H  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xfd: // (cb) 0xfd  SET 7,L  length: 2  cycles: 8  flags: ----  group: x8/rsb
          case 0xff: // (cb) 0xff  SET 7,A  length: 2  cycles: 8  flags: ----  group: x8/rsb
            r1 = this.r[cbop.z];
            this[r1] = this.SET(cbop.y, this[r1]);
            this.cycles += 8;
            break;

          case 0xc6: // (cb) 0xc6  SET 0,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xce: // (cb) 0xce  SET 1,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xd6: // (cb) 0xd6  SET 2,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xde: // (cb) 0xde  SET 3,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xe6: // (cb) 0xe6  SET 4,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xee: // (cb) 0xee  SET 5,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xf6: // (cb) 0xf6  SET 6,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
          case 0xfe: // (cb) 0xfe  SET 7,(HL)  length: 2  cycles: 16  flags: ----  group: x8/rsb
            this.writeByte(this.HL(), this.SET(cbop.y, this.readByte(this.HL())));
            this.cycles += 16;
            break;

          default:
            throw Error('(cb) ' + hexify(this.cbcode) + ' not found (pc=' + this.PC + ' next=' + hexify(this.readByte(this.PC + 1)) + ')');
        }
        break;

      default:
        throw Error(hexify(code) + ' not found (pc=' + this.PC + ' next=' + hexify(this.readByte(this.PC + 1)) + ')');
    }
    return this.cycles;
  }

  handleInterrupt(handler, flag) {
    // Save current PC and set to interrupt handler
    this.pushStack(this.PC);
    this.PC = handler;

    // Prevent further interrupts until RETI called
    this.IMEEnabled = false;

    // Reset IF bit
    this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) & ~flag)
  }

  updateInterrupts() {
    let interrupts = this.readByte(Constants.IE_REG) & this.readByte(Constants.IF_REG) & 0x1f;

    if (interrupts) {
      // Resume from halted CPU state
      this.haltMode = false;
    }
    // Interrupts disabled, exit early
    if (! this.IMEEnabled) {
      return;
    }

    if (interrupts & Constants.IF_VBLANK) {
      this.handleInterrupt(Constants.IH_VBLANK, Constants.IF_VBLANK);
    }
    else if (interrupts & Constants.IF_STAT) {
      this.handleInterrupt(Constants.IH_STAT, Constants.IF_STAT);
    }
    else if (interrupts & Constants.IF_TIMER) {
      this.handleInterrupt(Constants.IH_TIMER, Constants.IF_TIMER);
    }
    else if (interrupts & Constants.IF_SERIAL) {
      this.handleInterrupt(Constants.IH_SERIAL, Constants.IF_SERIAL);
    }
    else if (interrupts & Constants.IF_JOYPAD) {
      this.handleInterrupt(Constants.IH_JOYPAD, Constants.IF_JOYPAD);
    }
  }

  updateTimers() {
    // TIMA: increment timer and check for overflow
    let tac = this.readByte(Constants.TAC_REG)

    if (tac & 0b100) { // Check timer enabled
      let timer = this.readByte(Constants.TIMA_REG);
      let freq = Constants.TAC_CLOCK_SELECT[tac & 0b11];

      this.timerCycles += this.cycles;
      if (this.timerCycles >= freq) {
        timer++;
        this.timerCycles = 0;
      }
      // If overflow occurred: set TIMA to TMA value and trigger interrupt
      if (timer > 0xff) {
        timer = this.readByte(Constants.TMA_REG);
        this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) | Constants.IF_TIMER);
      }
      else {
        this.writeByte(Constants.IF_REG, this.readByte(Constants.IF_REG) & ~Constants.IF_TIMER);
      }
      // Update TIMA w/new value
      this.writeByte(Constants.TIMA_REG, timer);
    }

    // DIV: write to IO directly to avoid reset
    this.mmu.io[Constants.DIV_REG - 0xff00] = (this.totalCycles / 16384) & 0xff;
  }

  // CPU update
  update() {
    this.cycles = 0;
    this.prevCode = this.code;
    this.nextInstruction();
    this.updateTimers();
    this.updateInterrupts();
    this.totalCycles += this.cycles;
    return this.cycles;
  }
}
