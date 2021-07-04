"use strict"

function hexify(h) {
  if (h === undefined || h === null) return '(none)';
  let s = h.toString(16);
  if (s.length < 2) {
    return '0x0' + h.toString(16);
  }
  return '0x' + s;
}

function uint16(hi, lo) {
  return (hi << 8) + lo;
}

// Two's complement to decimal
function tcBin2Dec(num, bits=8) {
  let neg = (num & (1 << (bits - 1)));
  if (neg) {
    return num | ~((1 << bits) - 1);
  }
  return num;
}
