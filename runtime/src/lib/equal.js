import { GRAIN_TRUE, GRAIN_FALSE } from '../core/primitives';
import { view } from '../runtime';

import {
  GRAIN_ADT_HEAP_TAG,
} from '../core/tags';

function heapEqualHelp(heapTag, xptr, yptr, cycles) {
  switch (heapTag) {
  // TODO: String equality
  case GRAIN_ADT_HEAP_TAG:
    // Check if the same module
    if (view[xptr + 1] !== view[yptr + 1]) {
      return false;
    }
    // Check if the same constructor variant
    if (view[xptr + 2] !== view[yptr + 2]) {
      return false;
    }
    // Check that the arities are the same
    if (view[xptr + 3] !== view[yptr + 3]) {
      return false;
    }
    // Cycle check
    if (view[xPtr + 3] & 0x80000000) {
      return true;
    }
    let length = view[xptr + 3];
    ++cycles;
    view[xPtr + 3] |= 0x80000000;
    view[yPtr + 3] |= 0x80000000;
    let result = true;
    for (let i = 0; i < length; ++i) {
      if (!equalHelp(view[xPtr + i + 4],
                     view[yPtr + i + 4],
                     cycles)) {
        result = false;
        break;
      }
    }
    view[xPtr + 3] = length;
    view[yPtr + 3] = length;
    return result;
  default:
    // No other implementation
    return xptr === yptr;
  }
}

function equalHelp(x, y, cycles) {
  if ((x & 7) === 1) {
    if ((y & 7) !== 1) {
      return false;
    }
    let xPtr = (x ^ 1) / 4;
    let yPtr = (y ^ 1) / 4;
    if (view[xPtr] !== view[yPtr]) {
      return false;
    }
    if (view[xPtr] & 0x80000000) {
      return true;
    }
    let length = view[xPtr];
    ++cycles;
    view[xPtr] |= 0x80000000;
    view[yPtr] |= 0x80000000;
    let result = true;
    for (let i = 0; i < length; ++i) {
      if (!equalHelp(view[xPtr + i + 1],
                          view[yPtr + i + 1],
                          cycles)) {
        result = false;
        break;
      }
    }
    view[xPtr] = length;
    view[yPtr] = length;
    return result;
  } else if (x & 7 === 5) {
    if (y & 7 !== 5) {
      return false;
    }
    let xPtr = (x ^ 1) / 4;
    let yPtr = (y ^ 1) / 4;
    if (view[xPtr] !== view[yPtr]) {
      return false;
    }
    return heapEqualHelp(view[xPtr], xPtr, yPtr, cycles);
  } else {
    return x === y;
  }
}

export default function equal(x, y) {
  return equalHelp(x, y, 0) ? GRAIN_TRUE : GRAIN_FALSE;
}
