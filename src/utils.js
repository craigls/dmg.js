// Utility functions

function hexify(h) {
  if (h === undefined || h === null) return '(none)';
  const s = h.toString(16);
  if (s.length < 2) {
    return '0x0' + h.toString(16);
  }
  return '0x' + s;
}

function uint16(hi, lo) {
  return (hi << 8) + lo;
}

// Two's complement to decimal
function tcBin2Dec(num) {
  const neg = num & (1 << 7);
  if (neg) {
    return num | ~((1 << 7) - 1);
  }
  return num;
}

function getText(charCodes) {
  return charCodes.reduce((acc, cur) => acc + ((cur > 0) ? String.fromCharCode(cur) : ''), '');
}

window.hexify = hexify;
window.tcBin2Dec = tcBin2Dec;
window.uint16 = uint16;
window.getText = getText;
