import { memory, view, encoder, decoder } from '../runtime';
import { grainHeapAllocate } from '../core/heap';
import { GrainClosure } from '../core/closures';
import { GrainError } from '../errors/errors';
import { grainDOMRefs } from '../lib/DOM';

import {
  GRAIN_TUPLE_TAG_TYPE,
  GRAIN_LAMBDA_TAG_TYPE,
  GRAIN_GENERIC_HEAP_TAG_TYPE,
  GRAIN_DOM_ELEM_TAG,
  GRAIN_STRING_HEAP_TAG,
  GRAIN_ADT_HEAP_TAG,
  GRAIN_RECORD_HEAP_TAG
} from '../core/tags';

export function grainHeapValueToString(runtime, n) {
  switch (view[n / 4]) {
    case GRAIN_STRING_HEAP_TAG: {
      let byteView = new Uint8Array(memory.buffer);
      let length = view[(n / 4) + 1];
      let slice = byteView.slice(n + 8, n + 8 + length);
      return `"${decoder.decode(slice)}"`;
    }
    case GRAIN_DOM_ELEM_TAG: {
      return grainDOMRefs[view[(n + 4) / 4]].toString();
    }
    case GRAIN_ADT_HEAP_TAG: {
      let x = n / 4;
      // ADT string coercion is tricky, so these log statements can help
      // debug issues which might crop up:
      // console.log(`<ADT Value: (${view[x + 1]}, ${view[x + 2]}, ${view[x + 3]}, ${view[x + 4]})>`);
      if (runtime) {
        // In-memory tags are tagged ints
        let moduleId = view[x + 1] >> 1;
        let typeId = view[x + 2] >> 1;
        let variantId = view[x + 3] >> 1;
        // console.log(`\tModules: ${JSON.stringify(runtime.idMap)}`);
        let moduleName = runtime.idMap[moduleId];
        // console.log(`\tModule Name: ${moduleName}`);
        let module = runtime.modules[moduleName];
        // console.log(`\tModule: ${module}`);
        let tyinfo = module.types[typeId];
        // console.log(`\tType Info: ${JSON.stringify(tyinfo)}`);
        let info = tyinfo[variantId];
        // console.log(`\tVariant: ${info}`);
        let [variantName, arity] = info;
        let printedVals = [];
        for (let i = 0; i < arity; ++i) {
          printedVals.push(grainToString(runtime, view[x + 5 + i]));
        }
        if (arity === 0) {
          return variantName;
        } else {
          return `${variantName}(${printedVals.join(", ")})`;
        }
      }
      return "<adt value>";
    }
    case GRAIN_RECORD_HEAP_TAG: {
      let x = n / 4;
      // Record string coercion is tricky, so these log statements can help debug issues which might crop up
      if (runtime) {
        // In-memory tags are tagged ints
        let moduleId = view[x + 1] >> 1;
        let typeId = view[x + 2] >> 1;
        // console.log(`\tModules: ${JSON.stringify(runtime.idMap)}`);
        let moduleName = runtime.idMap[moduleId];
        // console.log(`\tModule Name: ${moduleName}`);
        let module = runtime.modules[moduleName];
        // console.log(`\tModule: ${module}`);
        let tyinfo = module.types[typeId];
        // console.log(`\tType Info: ${JSON.stringify(tyinfo)}`);
        
        if (Object.keys(tyinfo).length === 0) return '<record value>'
        
        let values = [];
        for (let [field, idx] of Object.entries(tyinfo)) {
          values.push(`${field}: ${grainToString(runtime, view[x + 3 + idx]).replace(/\n/g, '\n  ')}`)
        }
        return `{\n  ${values.join(',\n  ')}\n}`
      }
      return "<record value>";
    }
    default: {
      return `<unknown heap type: ${view[n / 4]}>`;
    }
  }
}

export function grainToString(runtime, n) {
  if (!(n & 1)) {
    return (n >> 1).toString();
  } else if ((n & 7) === GRAIN_TUPLE_TAG_TYPE) {
    let tupleIdx = (n ^ 1) / 4;
    let tupleLength = view[tupleIdx];
    if (tupleLength & 0x80000000) {
      return `<cyclic tuple ${n & 0x7FFFFFFF}>`;
    } else {
      view[tupleIdx] |= 0x80000000;
      let elts = [];
      for (let i = 0; i < tupleLength; ++i) {
        elts.push(grainToString(runtime, view[tupleIdx + i + 1]));
      }
      if (elts.length == 1) {
        elts.push("\b");
      }
      view[tupleIdx] = tupleLength;
      return `(${elts.join(", ")})`;
    }
  } else if ((n & 7) === GRAIN_LAMBDA_TAG_TYPE) {
    return "<lambda>";
  } else if ((n & 7) === GRAIN_GENERIC_HEAP_TAG_TYPE) {
    return grainHeapValueToString(runtime, n ^ 3);
  } else if ((n === -1)) {
    return "true";
  } else if (n === 0x7FFFFFFF) {
    return "false";
  } else {
    return `<Unknown value: 0x${n}>`;
  }
}

// TODO: Move
class GrainAdtValue {
  constructor(elts) {
    this._elts = elts;
  }

  get elts() {
    return this._elts;
  }
}

GrainAdtValue.prototype.toString = function() {
  if (this._elts.length === 1) {
    return this._elts[0];
  } else {
    return `${this._elts[0]}(${this._elts.slice(1).join(", ")})`;
  }
}

export function grainHeapValToJSVal(runtime, n) {
  switch (view[n / 4]) {
  case GRAIN_STRING_HEAP_TAG:
    let byteView = new Uint8Array(memory.buffer);
    let length = view[(n / 4) + 1];
    let slice = byteView.slice(n + 8, n + 8 + length);
    return decoder.decode(slice);
  case GRAIN_DOM_ELEM_TAG:
    let ref = n / 4;
    return grainDOMRefs[view[ref + 1]];
  case GRAIN_ADT_HEAP_TAG:
    // TODO: Make this reversible
    let x = n / 4;
    //console.log(`<ADT Value: (${view[x + 1]}, ${view[x + 2]}, ${view[x + 3]}, ${view[x + 4]})>`);
    if (runtime) {
      // In-memory tags are tagged ints
      let moduleId = view[x + 1] >> 1;
      let typeId = view[x + 2] >> 1;
      let variantId = view[x + 3] >> 1;
      let moduleName = runtime.idMap[moduleId];
      //console.log(`\tModule Name: ${moduleName}`);
      let module = runtime.modules[moduleName];
      //console.log(`\tModule: ${module}`);
      let tyinfo = module.types[typeId];
      //console.log(`\tType Info: ${JSON.stringify(tyinfo)}`);
      let info = tyinfo[variantId];
      //console.log(`\tVariant: ${info}`);
      let [variantName, arity] = info;
      let ret = [variantName];
      for (let i = 0; i < arity; ++i) {
        ret.push(grainToJSVal(runtime, view[x + 5 + i]));
      }
      return new GrainAdtValue(ret);
    }
  default:
    console.warn(`Unknown heap tag at ${n / 4}: ${view[n / 4]}`);
    return undefined;
  }
}

export function grainTupleToJSVal(runtime, n) {
  let tupleIdx = n / 4;
  let tupleLength = view[tupleIdx];
  if (tupleLength & 0x80000000) {
    return Symbol.for('cyclic');
  } else {
    view[tupleIdx] |= 0x80000000;
    let elts = [];
    for (let i = 0; i < tupleLength; ++i) {
      let value = grainToJSVal(runtime, view[tupleIdx + i + 1])
      if (value === Symbol.for('cyclic')) {
        elts.push(elts);
      } else {
        elts.push(value);
      }
    }
    view[tupleIdx] = tupleLength;
    return elts;
  }
}

export function grainToJSVal(runtime, x) {
  if (!(x & 1)) {
    return x >> 1;
  } else if ((x & 7) == 5) {
    return () => {
      throw new GrainError('Computed Grain functions are not callable from JavaScript.')
    }
  } else if ((x & 7) === 3) {
    return grainHeapValToJSVal(runtime, x ^ 3);
  } else if ((x & 7) === GRAIN_TUPLE_TAG_TYPE) {
    return grainTupleToJSVal(runtime, x ^ GRAIN_TUPLE_TAG_TYPE);
  } else if ((x === -1)) {
    return true;
  } else if (x === 0x7FFFFFFF) {
    return false;
  } else {
    console.warn(`Unknown Grain value: ${x} (0x${x.toString(16)})`);
    return undefined;
  }
}

export function JSToGrainVal(v) {
  if (typeof v === "number") {
    // TODO: overflow check
    if (v >= (1 << 30)) {
      throwGrainError(GRAIN_ERR_OVERFLOW, -1, -1);
    }
    return v << 1;
  } else if (typeof v === "boolean") {
    if (v) {
      return -1;
    } else {
      return 0x7FFFFFFF;
    }
  } else if (typeof v === "string") {
    let ptr = grainHeapAllocate(2 + (((v.length - 1) / 4) + 1)) / 4;
    view[ptr] = GRAIN_STRING_HEAP_TAG;
    view[ptr + 1] = v.length;
    let byteView = new Uint8Array(memory.buffer);
    let buf = encoder.encode(v);
    for (let i = 0; i < buf.length; ++i) {
      byteView[i + (ptr * 4) + 8] = buf[i];
    }
    return (ptr * 4) | GRAIN_GENERIC_HEAP_TAG_TYPE;
  } else {
    throw new GrainError(-1, "JSToGrainVal not implemented for value with type " + (typeof v));
  }
}
