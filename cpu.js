// Detects if half-carry occurs
function isHalfCarry(a, b) {
  return (((a & 0xf) + (b & 0xf)) & 0x10) === 0x10;
}

// Detects if carry occurs
function isCarry(a, b) {
  return ((a & b) & 0xffff) === 0x10000;
}

// Two's complement to decimal
function tcBin2Dec(num, bits=8) {
  let neg = (num & (1 << (bits - 1)));
  if (neg) {
    return num | ~((1 << bits) - 1);
  }
  return num;
}

function uint16(hi, lo) {
  return (hi << 8) + lo;
}
      
class CPU {
  constructor(mmu, ppu) {
    this.mmu = mmu;
    this.ppu = ppu;
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
    this.prevcode = null;
    this.totalCycles = 0;
    this.cycles = 0;
    this.IMEScheduled = -1;
    this.IMEEnabled = false;
  }

  reset() {
  }

  readByte(loc) {
    return this.mmu.readByte(loc);
  }

  writeByte(loc, value) {
    return this.mmu.writeByte(loc, value);
  }

  nextByte() {
    return this.readByte(this.PC++);
  }

  read(param) {

    switch (param) {
      case "(C)":
        return 0xff00 + this.C;

      case "a8":
        return 0xff00 + this.nextByte();

      case "d16":
      case "a16":
        return this.nextByte() + (this.nextByte() << 8);

      case "d8":
        return this.nextByte();

      case "r8":
        return tcBin2Dec(this.nextByte());

      default:
        throw new Error("Unknown operand: " + param);
    }
  }
      
  popStack() {
    this.SP++;
    let lo = this.readByte(this.SP);
    this.SP++;
    let hi = this.readByte(this.SP);
    return uint16(hi, lo);
  }

  pushStack(val) {
    this.writeByte(this.SP, val >> 8);
    this.SP--;
    this.writeByte(this.SP, val & 0xff);
    this.SP--;
  }

  incHL() {
    let val = uint16(this.H, this.L);
    val++;
    this.H = val >> 8;
    this.L = val & 0xff;
  }

  decHL() {
    let val = uint16(this.H, this.L);
    val--;
    this.H = val >> 8;
    this.L = val & 0xff;
  }


  PUSH(hi, lo) {
    this.pushStack(uint16(hi, lo));
  }

  POP(hi, lo) {
    let val = this.popStack();
    return [val >> 8, val & 0xff];
  }

  // Jump relative - no condition
  JR(offset) {
    let cycles = 12;
    this.PC += offset;
    return cycles;
  }
  
  JRC(offset) {
    let cycles = 8;
    if (this.F & C_FLAG) {
      this.PC += offset;
      cycles += 4;
    }
    return cycles;
  }

  // Jump relative if zero
  JRZ(offset) {
    let cycles = 8;
    if (this.F & Z_FLAG) {
      this.PC += offset;
      cycles += 4;
    }
    return cycles;
  }

  // Jump relative if not zero
  JRNZ(offset) {
    let cycles = 8;
    if (! (this.F & Z_FLAG)) {
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
    if (this.F & Z_FLAG) {
      this.PC = addr;
      cycles += 4;
    }
    return cycles;
  }

  // Call function
  CALL(addr) {
    let cycles = 24;
    // Save PC to the stack
    this.pushStack(this.PC);
    // Jump to the function
    this.PC = addr;
    return cycles;
  }

  // Call if not zero
  CALLNZ(addr) {
    let cycles = 12;
    if (! (this.F & Z_FLAG)) {
      // Save PC to the stack
      this.pushStack(this.PC);
      // Jump to the function
      this.PC = addr;
      cycles += 12;
    }
    return cycles;
  }

  // Return
  RET() {
    let cycles = 16;
    this.PC = this.popStack();
    return cycles;
  }

  // Return from interrupt
  RETI() {
    let cycles = 16;
    this.IMEEnabled = true;
    this.PC = this.popStack();
    return cycles;
  }

  // Return if zero
  RETZ() {
    let cycles = 8;
    if (this.F & Z_FLAG) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Return if not zero
  RETNZ() {
    let cycles = 8;
    if (! (this.F & Z_FLAG)) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Return if not carry 
  RETNC() {
    let cycles = 8;
    if (! (this.F & C_FLAG)) {
      this.PC = this.popStack();
      cycles += 12;
    }
    return cycles;
  }

  // Enable interrupt
  EI() {
    this.IMEScheduled = this.PC + 1;
  }

  // Disable interrupts
  DI() {
    this.IMEEnabled = false;
  }

  // Test if n-th bit is set
  BIT(bit, num) {
    this.F &= ~N_FLAG;
    this.F &= ~H_FLAG;
    this.F &= ~Z_FLAG;

    // Set Z_FLAG if bit set
    if ((num & (1 << bit)) === 0) {
      this.F |= Z_FLAG;
    }
    return num;
  }

  // AND
  AND(b) {
    let val = this.A & b;

    this.F &= ~Z_FLAG;
    this.F &= ~N_FLAG;
    this.F |= H_FLAG;
    this.F &= ~C_FLAG;

    if (val === 0) {
      this.F |= Z_FLAG;
    }
    return val;
  }

  // OR
  OR(n) {
    let val = this.A | n;
    this.F &= ~Z_FLAG;
    this.F |= N_FLAG;
    this.F |= H_FLAG;
    this.F |= C_FLAG;

    if (val === 0) {
      this.F |= Z_FLAG;
    }
    return val;
  }

  // XOR
  XOR(n) {
    let val = this.A ^ n;
    this.F &= ~Z_FLAG;
    this.F |= N_FLAG;
    this.F |= H_FLAG;
    this.F |= C_FLAG;

    // Set Z == 0 if zero
    if (val === 0) {
      this.F |= Z_FLAG;
    }
    return val;
  }

  // Rotate left to carry bit
  RL(n) {

    // Shift the carry flag onto bit 0
    let carry = ((this.F & C_FLAG) !== 0) ? 1 : 0;
    let rot = (n << 1) | carry;

    // Reset all flags
    this.F &= ~H_FLAG;
    this.F &= ~N_FLAG;
    this.F &= ~Z_FLAG;
    this.F &= ~C_FLAG;

    // Set C_FLAG and Z_FLAG from resulting rotation
    if ((rot >> 8) & 1 !== 0) {
      this.F |= C_FLAG;
    }
    if ((rot & 0xff) === 0) {
      this.F |= Z_FLAG;
    }
    return rot & 0xff;
  }

  // Rotate left
  RLA(n) {
    let rot = this.RL(n);

    // Reset all excluding carry flag
    this.F &= ~H_FLAG;
    this.F &= ~N_FLAG;
    this.F &= ~Z_FLAG;
    return rot;
  }

  // Rotate left to carry bit and bit 0
  RLC(n) {
    let rot = this.RL(n);

    // Reset all excluding carry flag
    this.F &= ~H_FLAG;
    this.F &= ~N_FLAG;
    this.F &= ~Z_FLAG;

    // Add carry bit
    if (this.F & C_FLAG) {
      rot |= 1;
    }
    return rot & 0xff;
  }

  // Shift right
  SRL(n) {
    if ((n & (1 << 0)) !== 0) {
      this.F &= C_FLAG;
    }
    else { 
      this.F &= ~C_FLAG;
    }
    return n >> 1;
  }
    
  // Rotate right w/carry
  RR(n) {
    let carry = (this.F & C_FLAG) ? 1 : 0;
    let rot = (n >> 1) | (carry << 7);

    this.F &= ~C_FLAG;

    if (rot > 256) {
      this.F |= C_FLAG;
    }
    return rot & 0xff;
  }

  // Increment
  INC(n) {
    let val = n + 1;

    this.F &= ~Z_FLAG;
    this.F &= ~N_FLAG;
    this.F &= ~H_FLAG;

    if (isHalfCarry(n, 1)) {
      this.F |= H_FLAG;
    }
    if ((val & 0xff) === 0) {
      this.F |= Z_FLAG;
    }
    return val & 0xff;
  }

  // Increment register pair
  INC16(hi, lo) {
    let val = uint16(hi, lo);
    val++;
    return [val >> 8, val & 0xff];
  }

  // Decrement
  DEC(n) {
    let val = n - 1;
    this.F |= N_FLAG;
    this.F &= ~H_FLAG;
    this.F &= ~Z_FLAG;

    if (isHalfCarry(n, -1)) {
      this.F |= H_FLAG;
    }
    if ((val & 0xff) === 0) {
      this.F |= Z_FLAG;
    }
    return val & 0xff;
  }

  // Decrement register pair
  DEC16(hi, lo) {
    let val = uint16(hi, lo);
    val--;
    return [val >> 8, val & 0xff];
  }

  // Addition of a + b + carry bit
  ADC(a, b) {
    let carry = (this.F & C_FLAG) ? 1 : 0;
    return this.ADD(a, b + carry);
  }

  ADD16(a, b, subtract=false) {
    let lo = this.ADD(a & 0xff, b & 0xff);
    let hi = this.ADD(a >> 8, b >> 8);
    this.F &= ~Z_FLAG;
    return [hi, lo];
  }

  // Addition
  ADD(a, b) {
    let val = a + b;

    this.F &= ~Z_FLAG;
    this.F &= ~H_FLAG;
    this.F &= ~C_FLAG;
    this.F &= ~N_FLAG;

    if ((val & 0xff) === 0) {
      this.F |= Z_FLAG;
    }
    if (val > 255) {
      this.F |= C_FLAG;
    }
    if (isHalfCarry(a, b)) {
      this.F |= H_FLAG;
    }
    return val & 0xff;
  }

  // Subtraction
  SUB(a, b) {
    let val = a - b;

    this.F &= ~Z_FLAG;
    this.F &= ~H_FLAG;
    this.F &= ~C_FLAG;
    this.F |= N_FLAG;

    if (val < 0) {
      this.F |= C_FLAG;
    }
    if (isHalfCarry(a, -b)) {
      this.F |= H_FLAG;
    }
    if (a === b) {
      this.F |= Z_FLAG;
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
    return this.SUB(this.A, n);
  }

  // Flip bits in A register, set N and H flags
  CPL() {
    this.F |= N_FLAG;
    this.F |= H_FLAG;
    this.A = ~this.A;
    return this.A;
  }

  // Swap high/low nibbles
  SWAP(n) {
    let hi = (n & 0x0f) << 4;
    let lo = (n & 0xf0) >> 4;
    let result = hi | lo;

    this.F &= ~Z_FLAG;
    this.F &= ~N_FLAG;
    this.F &= ~H_FLAG;
    this.F &= ~C_FLAG;

    if (result === 0) {
      this.F |= Z_FLAG;
    }
    return result;
  }

  // Execute instructions
  execute(code) {
    // TODO: Eliminate giant switch statement

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

      // 0x03  INC BC  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x03:
        [this.B, this.C] = this.INC16(this.B, this.C);
        this.cycles += 8;
        break;

      // 0x04  INC B  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x04:
        this.B = this.INC(this.B);
        this.cycles += 4;
        break;

      // 0x09  ADD HL,BC  length: 1  cycles: 8  flags: -0HC  group: x16/alu
      case 0x09:
        [this.H, this.L] = this.ADD16(uint16(this.H, this.L), uint16(this.B, this.C));
        this.cycles += 8;
        break;

      // 0x0b  DEC BC  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x0b:
        [this.B, this.C] = this.DEC16(uint16(this.B, this.C));
        this.cycles += 8;
        break;

      // 0x11  LD DE,d16  length: 3  cycles: 12  flags: ----  group: x16/lsm
      case 0x11:
        this.E = this.nextByte();
        this.D = this.nextByte();
        this.cycles += 12;
        break;

      // 0x14  INC D  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x14:
        this.D = this.INC(this.D);
        this.cycles += 4;
        break;


      // 0x19  ADD HL,DE  length: 1  cycles: 8  flags: -0HC  group: x16/alu
      case 0x19:
        [this.H, this.L] = this.ADD16(uint16(this.H, this.L), uint16(this.D, this.E));
        this.cycles += 8;
        break

      // 0x1a  LD A,(DE)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x1a:
        this.A = this.readByte(uint16(this.D, this.E));
        this.cycles += 8;
        break;

      // 0x20  JR NZ,r8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x20: 
        this.cycles += this.JRNZ(this.read("r8"));
        break;

      // 0x28  JR Z,r8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x28:
        this.cycles += this.JRZ(this.read("r8"));
        break;

      // 0x22  LD (HL+),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x22:
        this.writeByte(uint16(this.H, this.L), this.A);
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

      // 0xcd  CALL a16  length: 3  cycles: 24  flags: ----  group: control/br
      case 0xcd:
        this.cycles += this.CALL(this.read("a16"));
        break;

      // 0xc4  CALL NZ,a16  length: 3  cycles: 24,12  flags: ----  group: control/br
      case 0xc4:
        this.cycles += this.CALLNZ(this.read("a16"));
        break;

      // 0xc6  ADD A,d8  length: 2  cycles: 8  flags: Z0HC  group: x8/alu
      case 0xc6:
        this.A = this.ADD(this.A, this.read("d8"));
        this.cycles += 8;
        break;

      // 0x4f  LD C,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x4f:
        this.C = this.A;
        this.cycles += 4;
        break;

      // 0x07  LD B,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x06:
        this.B = this.read("d8"); 
        this.cycles += 8;
        break;

      // 0x07  RLCA  length: 1  cycles: 4  flags: 000C  group: x8/rsb
      case 0x07:
        this.A = this.RLC(this.A);
        this.cycles += 4;
        break;

      // 0xc1  POP BC  length: 1  cycles: 12  flags: ----  group: x16/lsm
      case 0xc1:
        [this.B, this.C] = this.POP();
        this.cycles += 12;
        break;

      // 0xef  RST 28H  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xef:
        this.RST(0x28);
        this.cycles += 16;
        break;

      // 0xd0  RET NC  length: 1  cycles: 20,8  flags: ----  group: control/br
      case 0xd0:
        this.cycles += this.RETNC();
        break;

      // 0xd1  POP DE  length: 1  cycles: 12  flags: ----  group: x16/lsm
      case 0xd1:
        [this.D, this.E] = this.POP();
        this.cycles += 12;
        break;


      // 0xd6  SUB d8  length: 2  cycles: 8  flags: Z1HC  group: x8/alu
      case 0xd6:
        this.A = this.SUB(this.A, this.read("d8"));
        this.cycles += 8;
        break;

      // 0xd9  RETI  length: 1  cycles: 16  flags: ----  group: control/br
      case 0xd9:
        this.cycles += this.RETI();
        break;

      // 0xe1  POP HL  length: 1  cycles: 12  flags: ----  group: x16/lsm
      case 0xe1:
        [this.H, this.L] = this.POP();
        this.cycles += 12;
        break;

      // 0xf1  POP AF  length: 1  cycles: 12  flags: ZNHC  group: x16/lsm
      case 0xf1:
        // TODO: confirm correct behavior
        let tmpF;
        [this.A, tmpF] = this.POP();
        this.F = this.ADD(this.F, tmpF) & 0xf0;
        this.cycles += 12;
        break;

      // 0xf3  DI  length: 1  cycles: 4  flags: ----  group: control/misc
      case 0xf3:
        // TODO: Disable interrupt 
        this.DI();
        this.cycles += 4;
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

      // 0xc5  PUSH BC  length: 1  cycles: 16  flags: ----  group: x16/lsm
      case 0xc5:
        this.PUSH(this.B, this.C);
        this.cycles += 16;
        break;
 
      // 0xd5  PUSH DE  length: 1  cycles: 16  flags: ----  group: x16/lsm
      case 0xd5:
        this.PUSH(this.E, this.E);
        this.cycles += 16;
        break;

      // 0xe5  PUSH HL  length: 1  cycles: 16  flags: ----  group: x16/lsm
      case 0xe5:
        this.PUSH(this.H, this.L);
        this.cycles += 16;
        break;

      // 0xf5  PUSH AF  length: 1  cycles: 16  flags: ----  group: x16/lsm
      case 0xf5:
        this.PUSH(this.A, this.F);
        this.cycles += 16;
        break;

      // 0x02  LD (BC),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x02:
        this.writeByte(uint16(this.B, this.C), this.A);
        this.cycles += 8;
        break;

      // 0x05  DEC B  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x05:
        this.B = this.DEC(this.B);
        this.cycles += 4;
        break;

      // 0x0c  INC C  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x0c:
        this.C = this.INC(this.C);
        this.cycles += 4;
        break;

      // 0x0d  DEC C  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x0d:
        this.C = this.DEC(this.C);
        this.cycles += 4;
        break;

     // 0x0e  LD C,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x0e:
        this.C = this.read("d8");
        this.cycles += 8;
        break;

      // 0x17  RLA  length: 1  cycles: 4  flags: 000C  group: x8/rsb
      case 0x17:
        this.A = this.RLA(this.A);
        this.cycles += 4;
        break;

      // 0x18  JR r8  length: 2  cycles: 12  flags: ----  group: control/br
      case 0x18:
        this.JR(this.read("r8"));
        this.cycles += 12;
        break;

      // 0xa5  AND L  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa5:
        this.A = this.AND(this.L);
        this.cycles += 4;
        break;

      // 0xa7  AND A  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa7:
        this.A = this.AND(this.A);
        this.cycles += 4;
        break;

      // 0x0a  LD A,(BC)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x0a:
        this.A = this.readByte(uint16(this.B, this.C));
        this.cycles += 4;
        break;

      // 0xe2  LD (C),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0xe2:
        this.writeByte(this.read("(C)"), this.A);
        this.cycles += 8;
        break;

      // 0xe6  AND d8  length: 2  cycles: 8  flags: Z010  group: x8/alu
      case 0xe6:
        this.A = this.AND(this.read("d8"));
        this.cycles += 8;
        break;

      // 0xe8  ADD SP,r8  length: 2  cycles: 16  flags: 00HC  group: x16/alu
      /*
      case 0xe8:
        this.SP = this.add(this.SP, tcBin2Dec(this.readByte(this.PC++)));
        break;
      */

      // 0xe9  JP (HL)  length: 1  cycles: 4  flags: ----  group: control/br
      case 0xe9:
        this.PC = this.readByte(uint16(this.H, this.L));
        this.cycles += 4;
        break;

      // 0x31  LD SP,d16  length: 3  cycles: 12  flags: ----  group: x16/lsm
      case 0x31:
        this.SP = this.read("d16");
        this.cycles += 12;
        break;

      // 0x35  DEC (HL)  length: 1  cycles: 12  flags: Z1H-  group: x8/alu
      /*
      case 0x35:
        addr = (this.H << 8) + this.L;
        val = this.dec(this.readByte(addr));
        this.writeByte(addr, val);
        this.cycles += 12;
        break;
      */

      // 0x36  LD (HL),d8  length: 2  cycles: 12  flags: ----  group: x8/lsm
      case 0x36:
        this.writeByte(uint16(this.H, this.L), this.read("d8"));
        this.cycles += 12;
        break;

      // 0xa1  AND C  length: 1  cycles: 4  flags: Z010  group: x8/alu
      case 0xa1:
        this.A = this.AND(this.C);
        this.cycles += 4;
        break;

      // 0xae  XOR (HL)  length: 1  cycles: 8  flags: Z000  group: x8/alu
      case 0xae:
        this.A = this.XOR(this.readByte(uint16(this.H, this.L)));
        this.cycles += 8;
        break;

      // 0xa9  XOR C  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xa9:
        this.A = this.XOR(this.C);
        this.cycles += 4;
        break;

      // 0xaf  XOR A  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xaf: 
        this.A = this.XOR(this.A);
        this.cycles += 4;
        break;

      // 0xb0  OR B  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb0:
        this.A = this.OR(this.B);
        this.cycles += 4;
        break;

      // 0xb1  OR C  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb1:
        this.A = this.OR(this.C);
        this.cycles += 4;
        break;

      // 0xb3  OR E  length: 1  cycles: 4  flags: Z000  group: x8/alu
      /*
      case 0xb3:
        this.A  = this.or(this.A, this.E);
        this.cycles += 4;
        break;
      */

      // 0xb6  OR (HL)  length: 1  cycles: 8  flags: Z000  group: x8/alu
      case 0xb6:
        this.OR(this.readByte(uint16(this.H, this.L)));
        this.cycles += 8;
        break;

      // 0xb7  OR A  length: 1  cycles: 4  flags: Z000  group: x8/alu
      case 0xb7:
        this.A = this.OR(this.A);
        this.cycles += 4;
        break;

      // 0xb9  CP C  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0xb9:
        this.CP(this.C);
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

      // 0xce  ADC A,d8  length: 2  cycles: 8  flags: Z0HC  group: x8/alu
      case 0xce:
        this.A = this.ADC(this.A, this.read("d8"));
        this.cycles += 8;
        break;

      // 0x8c  ADC A,H  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x8c:
        this.A = this.ADC(this.A, this.H);
        this.cycles += 4;
        break;

      // 0x8e  ADC A,(HL)  length: 1  cycles: 8  flags: Z0HC  group: x8/alu
      case 0x8e:
        this.A = this.ADC(this.readByte(uint16(this.H, this.L)));
        this.cycles += 4;
      break;

      // 0xfb  EI  length: 1  cycles: 4  flags: ----  group: control/misc
      case 0xfb:
        this.EI();
        this.cycles += 4;
        break;

      // 0x15  DEC D  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x15:
        this.D = this.DEC(this.D);
        this.cycles += 4;
        break;

      // 0x16  LD D,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x16:
        this.D = this.read("d8");
        this.cycles += 8;
        break;

      // 0x1b  DEC DE  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x1b:
        [this.D, this.E] = this.DEC16(this.D, this.E);
        this.cycles += 8;
        break;

      // 0x1c  INC E  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x1c:
        this.E = this.INC(this.E)
        this.cycles += 4;
        break;

      // 0x25  DEC H  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x25:
        this.H = this.DEC(this.H);
        this.cycles += 4;
        break;

      // 0x2c  INC L  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x2c:
        this.L = this.INC(this.L);
        this.cycles += 4;
        break;

      // 0x3c  INC A  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x3c:
        this.A = this.INC(this.A);
        this.cycles += 4;
        break;

      // 0xbe  CP (HL)  length: 1  cycles: 8  flags: Z1HC  group: x8/alu
      case 0xbe:
        this.CP(this.readByte(uint16(this.H, this.L)));
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
        this.A = this.readByte(uint16(this.H, this.L));
        this.incHL();
        break;

      // 0xfa  LD A,(a16)  length: 3  cycles: 16  flags: ----  group: x8/lsm
      case 0xfa:
        this.A = this.readByte(this.read("a16"));
        this.cycles += 16;
        break;

      // 0x2d  DEC L  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x2d:
        this.L = this.DEC(this.L);
        this.cycles += 4;
        break;

      // 0x2e  LD L,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x2e:
        this.L = this.read("d8");
        this.cycles += 8;
        break;

      // 0x32  LD (HL-),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x32:
        this.writeByte(uint16(this.H, this.L), this.A);
        this.decHL();
        this.cycles += 8;
        break;

      // 0x3d  DEC A  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x3d:
        this.A = this.DEC(this.A);
        this.cycles += 4;
        break;

      // 0x3e  LD A,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x3e:
        this.A = this.read("d8");
        this.cycles += 8;
        break;

      // 0x40  LD B,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      /*
      case 0x40:
        this.B = this.B;
        this.cycles += 4;
        break;
      */

      // 0x44  LD B,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x44:
        this.B = this.H;
        this.cycles += 4;
        break;

      // 0x46  LD B,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x46:
        this.B = this.readByte(uint16(this.H, this.L));
        this.cycles += 8;
        break;

      // 0x47  LD B,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x47:
        this.B = this.A;
        this.cycles += 4;
        break;

    // 0x4e  LD C,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x4e:
        this.C = this.readByte(uint16(this.H, this.L));
        this.cycles += 8;
        break;

      // 0x5a  LD E,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5a:
        this.E = this.D;
        this.cycles += 4;
        break;

      // 0x56  LD D,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x56:
        this.D = this.readByte(uint16(this.H, this.L));
        this.cycles += 8;
        break;

      // 0x57  LD D,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x57:
        this.D = this.A;
        this.cycles += 4;
        break;

      // 0x5e  LD E,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x5e:
        this.E = this.readByte(uint16(this.H, this.L));
        this.cycles += 8;
        break;

      // 0x5f  LD E,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x5f:
        this.E = this.A;
        this.cycles += 4;
        break;

      // 0x67  LD H,A  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x67:
        this.H = this.A;
        this.cycles += 4;
        break;
      
      // 0x77  LD (HL),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x77:
        this.writeByte(uint16(this.H, this.L), this.A);
        this.cycles += 8;
        break;

      // 0x78  LD A,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x78:
        this.A = this.B;
        this.cycles += 4;
        break;

      // 0x79  LD A,C  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x79:
        this.A = this.C;
        this.cycles += 4;
        break;

      // 0x7d  LD A,L  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7d:
        this.A = this.L;
        this.cycles += 4;
        break;

      // 0x7e  LD A,(HL)  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x7e:
        this.A = this.readByte(uint16(this.H, this.L));
        this.cycles += 8;
        break;

      // 0x80  ADD A,B  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      /*
      case 0x80:
        this.A = this.add(this.A, this.B);
        this.cycles += 4;
        break;
      */

      // 0x86  ADD A,(HL)  length: 1  cycles: 8  flags: Z0HC  group: x8/alu
      case 0x86:
        this.A = this.ADD(this.A, this.readByte(uint16(this.H, this.L)));
        this.cycles += 8;
        break;

      // 0x87  ADD A,A  length: 1  cycles: 4  flags: Z0HC  group: x8/alu
      case 0x87:
        this.A = this.ADD(this.A, this.A);
        this.cycles += 8;
        break;

      // 0x90  SUB B  length: 1  cycles: 4  flags: Z1HC  group: x8/alu
      case 0x90:
        this.A = this.SUB(this.A, this.B);
        this.cycles += 4;
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

      // 0x6b  LD L,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x6b:
        this.L = this.E;
        this.cycles += 4;
        break;

      // 0x68  LD L,B  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x68:
        this.L = this.B;
        this.cycles += 4;
      break;

      // 0x7b  LD A,E  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7b:
        this.A = this.E;
        this.cycles += 4;
        break;

      // 0x12  LD (DE),A  length: 1  cycles: 8  flags: ----  group: x8/lsm
      case 0x12:
        this.writeByte(uint16(this.D, this.E), this.A);
        this.cycles += 8;
        break;

      // 0x13  INC DE  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x13:
        [this.D, this.E] = this.INC16(this.D, this.E);
        this.cycles += 8;
        break;

      // 0x1e  LD E,d8  length: 2  cycles: 8  flags: ----  group: x8/lsm
      case 0x1e:
        this.E = this.read("d8");
        this.cycles += 8;
        break;

      // 0x23  INC HL  length: 1  cycles: 8  flags: ----  group: x16/alu
      case 0x23:
        [this.H, this.L] = this.INC16(this.H, this.L);
        this.cycles += 8;
        break;

      // 0x24  INC H  length: 1  cycles: 4  flags: Z0H-  group: x8/alu
      case 0x24:
        this.H = this.INC(this.H);
        this.cycles += 4;
        break;

      // 0x27  DAA  length: 1  cycles: 4  flags: Z-0C  group: x8/alu
      case 0x27:
        this.cycles += 4;
        break;

      // 0x1d  DEC E  length: 1  cycles: 4  flags: Z1H-  group: x8/alu
      case 0x1d:
        this.E = this.DEC(this.E);
        this.cycles += 4;
        break;

      // 0x34  INC (HL)  length: 1  cycles: 12  flags: Z0H-  group: x8/alu
      case 0x34:
        this.writeByte(uint16(this.H, this.L), this.INC(this.readByte(uint16(this.H, this.L)) + 1));
        this.cycles += 12;
        break;

      // 0x38  JR C,r8  length: 2  cycles: 12,8  flags: ----  group: control/br
      case 0x38:
        this.cycles += this.JRC(this.read("r8"));
        break;

      // 0x7a  LD A,D  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7a:
        this.A = this.D;
        this.cycles += 4;
        break;

      // 0x7c  LD A,H  length: 1  cycles: 4  flags: ----  group: x8/lsm
      case 0x7c:
        this.A = this.H;
        this.cycles += 4;
        break;

      // cb prefixes
      case 0xcb: 
        // Get the actual cbcode
        let cbcode = this.nextByte();

        switch(cbcode) {
          // (cb) 0x11  RL C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x11:
            this.C = this.RL(this.C);
            this.cycles += 8;
            break;


          // (cb) 0x19  RR C  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x19:
            this.C = this.RR(this.C);
            this.cycles += 8;
            break;

          // (cb) 0x1a  RR D  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x1a:
            this.D = this.RR(this.D);
            this.cycles += 8;
            break;

          // (cb) 0x7c  BIT 7,H  length: 2  cycles: 8  flags: Z01-  group: x8/rsb
          case 0x7c:
            this.BIT(7, this.H);
            this.cycles += 2;
            break;

          // (cb) 0x37  SWAP A  length: 2  cycles: 8  flags: Z000  group: x8/rsb
          case 0x37:
            this.A = this.SWAP(this.A);
            this.cycles += 8;
            break;

          // (cb) 0x38  SRL B  length: 2  cycles: 8  flags: Z00C  group: x8/rsb
          case 0x38:
            this.B = this.SRL(this.B);
            this.cycles += 8;
            break;

          default: 
            throw Error('(cb) ' + hexify(cbcode) + ' not found (pc=' + this.PC + ' next=' + hexify(this.readByte(this.PC + 1)) + ')');
        }
        break;
            
      default: 
        throw Error(hexify(code) + ' not found (pc=' + this.PC + ' next=' + hexify(this.readByte(this.PC + 1)) + ')');
    }
    return this.cycles;
  }

  updateIME() {
    if (this.IMEScheduled === this.PC) {
      this.IMEEnabled = true;
      this.IMEScheduled = -1;
    }
  }

  handleInterrupt(handler) {
    this.IMEEnabled = false;
    this.cycles += 2;
    this.cycles += this.CALL(handler);
  }

  updateInterrupts() {
    if (! this.IMEEnabled) {
      return;
    }

    let h = this.readByte(IE_REG) & this.readByte(IF_REG) & 0x1f;

    switch(h) {
      case (h & IF_VBLANK):
        this.handleInterrupt(IH_VBLANK);
        break;

      case (h & IF_LCDSTAT):
        this.handleInterrupt(IH_LCDSTAT);
        break;
      
      case (h & IF_TIMER):
        this.handleInterrupt(IH_TIMER);
        break;

      case (h & IF_SERIAL):
        this.handleInterrupt(IH_SERIAL);
        break;
      
      case (h & IF_JOYPAD):
        this.handleInterrupt(IH_JOYPAD);
        break;
    }
  }

  // CPU update 
  update() {
    this.cycles = 0;
    this.prevcode = this.code;
    this.code = this.nextByte();
    this.execute(this.code);
    this.updateIME();
    this.updateInterrupts();
    this.totalCycles += this.cycles;
    return this.cycles;
  }
}
