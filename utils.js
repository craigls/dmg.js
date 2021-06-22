
// Random junk

function hexify(h) {
  s = h.toString(16);
  if (s.length < 2) {
    return '0x0' + h.toString(16);
  }
  return '0x' + s;
}

// Save call for debugging
function recordCall(reg, code, cycles) {
    calls.push({
      code: code, 
      cycles: cycles, 
      PC: reg.PC, SP: reg.SP, 
      A: reg.A, F: reg.F, 
      B: reg.B, C: reg.C, 
      D: reg.D, E: reg.E,
      H: reg.H, L: reg.L, 
    })
}

function printStack(n=10) {
  let sp = dmg.cpu.SP;
  while (n >= 0) {
    sp++;
    let lo = dmg.mmu.readByte(sp);
    sp++;
    let hi = dmg.mmu.readByte(sp);
    console.log("SP=" + sp + " value=" + uint16(hi, lo) + " hex=" + hexify(uint16(hi, lo)) + " hi=" + hi + " lo=" + lo);
    n--;
  }
}
    
    
function printCalls(start=0, count=25) {
  if (start === 0) {
    start = calls.length - count;
  }
  calls.slice(start, start + count).forEach(function(call, i) {
    console.log('cycles=' + call.cycles + ' PC=' + call.PC + ' code=' + hexify(call.code) + ' A=' + call.A + ' F=' + call.F + ' D=' + call.D + ' E=' + call.E + ' B=' + call.B +  ' C=' + call.C + ' H=' + call.H + ' L=' + call.L + ' SP=' + call.SP);
  });
}

function blargg() {
  let c = dmg.mmu.readByte(0xff01);
  console.log(String.fromCharCode(c));
  dmg.mmu.writeByte(0xff02, 0x0);
}
