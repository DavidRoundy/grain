import { mallocJSModule } from './malloc';
import { getTagType, tagToString, heapTagToString, GRAIN_CONST_TAG_TYPE, GRAIN_NUMBER_TAG_TYPE, GRAIN_TUPLE_TAG_TYPE, GRAIN_GENERIC_HEAP_TAG_TYPE, GRAIN_LAMBDA_TAG_TYPE,
         GRAIN_STRING_HEAP_TAG, GRAIN_DOM_ELEM_TAG, GRAIN_ADT_HEAP_TAG } from './tags';
import { grainAdtInfo, toHex, toBinary } from '../utils/utils';

const TRACE_MEMORY = true;

// Graph coloring
const GREEN = 'G';
const RED = 'R';
const BLUE = 'BLUE';

function trace(msg) {
  if (TRACE_MEMORY) {
    console.warn(msg);
  }
}

/* Notes:
 *
 * Grain's memory system uses a reference-counted garbage collector.
 * Because `ManagedMemory` is the point of communication between the Grain runtime
 * and the memory management system, we are able to neatly intercept the pointers
 * which are visible to the Grain runtime and tag them with our counts. It is
 * then incumbent upon the compiler (and any Grain plugins which interact with memory)
 * to make sure that reference counting functionality exists at appropriate places
 * in code. Here is the basic idea for how this looks in practice for an n-byte heap object:
 *
 * [ 0 bit <reserved> ][ 11-bit counter ][ 4-bit value tag ][ n-bit payload ]
 * ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^~~~~~~~~~~~~~~~
 * {start address}                                          {pointer used by grain runtime}
 *
 * Some notes about this scheme:
 * - The value tag is the same tag used to identify the pointer on the stack
 * - The value tag is admittedly inefficient (since it duplicates the stack value tag),
 *   but it is a "good enough for now" approach for allowing traversal
 * - If studying this design, one will notice this only allows a maximum of 2048 references to a given
 *   GC-managed object. In the future, we will ideally come up with a method of making this
 *   work with a greater number of values.
 *
 *
 * Variable Naming Conventions:
 *   rawPtr  : The pointer returned by the call to malloc()
 *   userPtr : The pointer returned (and referenced by) to the Grain runtime
 */
export class ManagedMemory {
  constructor(memory) {
    this._memory = memory;
    this._headerSize = 8; // 32 bits in bytes (extra space needed for alignment)
    this._runtime = null;
    if (typeof window === 'undefined') {
      this._globNS = global;
    } else {
      this._globNS = window;
    }
    this._mallocModule = mallocJSModule(this._globNS, {
      initialHeapSize: memory.buffer.byteLength,
      growHeap: () => this._growHeap()
    }, this._memory.buffer);
    this._grown = 0;
    this._colors = {};
    if (TRACE_MEMORY) {
      this._allocatedAddresses = new Set();
      this._freedAddresses = new Set();
      this._timesAllocated = {};
      this._timesFreed = {};
      this._incRefSources = {};
      this._decRefSources = {};
      this._knownTagTypes = {};
    }
  }

  _growHeap() {
    //console.log('_growHeap');
    if (this._runtime && this._runtime.limitMemory >= 0 && this._grown >= this._runtime.limitMemory) {
      //throw 'Out of memory (_growHeap)';
      return -1;
    }
    this._grown += 1024;
    // doesn't actually work; we are just simulating a smaller memory size for GC tests
    //return this._memory.grow(1);
    return 0;
  }

  setRuntime(runtime) {
    this._runtime = runtime;
    if (runtime.limitMemory >= 0) {
      this._mallocModule = mallocJSModule(this._globNS, {
        initialHeapSize: runtime.limitMemory,
        growHeap: () => this._growHeap()
      }, this._memory.buffer);
      this._grown = 0;
    }
    if (TRACE_MEMORY) {
      runtime.postImports = () => {
        this._allocatedAddresses = new Set();
        this._timesAllocated = {};
        this._timesFreed = {};
        this._incRefSources = {};
        this._decRefSources = {};
        this._knownTagTypes = {};
      }
    }
  }

  malloc(size) {
    trace(`malloc(0x${this._toHex(size)})`);
    let rawPtr = this._mallocModule.malloc(size + this._headerSize);
    if (rawPtr === -1 || (this._runtime && this._runtime.limitMemory >= 0 && this._runtime.limitMemory <= rawPtr)) {
      trace(`OOM; ret=${rawPtr}; limit=${this._runtime && this._runtime.limitMemory}; less than=${this._runtime && this._runtime.limitMemory >= 0 && this._runtime.limitMemory <= rawPtr}`);
      throw 'Out of memory';
    }
    trace('\tpopulateHeader')
    this.populateHeader(rawPtr);
    trace('\tend_populateHeader')
    let userPtr = rawPtr + this._headerSize;
    trace(`malloc: ${this._memdump(userPtr)}`);
    if (TRACE_MEMORY) {
      this._allocatedAddresses.add(userPtr);
      if (typeof this._maxAddress === 'undefined') {
        this._maxAddress = rawPtr + size + this._headerSize;
      } else {
        this._maxAddress = Math.max(rawPtr + size + this._headerSize, this._maxAddress);
      }
      if (typeof this._minAddress === 'undefined') {
        this._minAddress = rawPtr;
      } else {
        this._minAddress = Math.min(rawPtr, this._minAddress);
      }
      this._timesAllocated[userPtr] = (this._timesAllocated[userPtr] || 0) + 1;
      this._freedAddresses.delete(userPtr);
    }
    this._markIncRefSource(userPtr, 'MALLOC');
    return userPtr; // offset by headerSize
  }

  populateHeader(rawPtr) {
    let tag = 0x0; // reserved
    trace('populateHeader');
    var heap = new Uint8Array(this._memory.buffer);
    for (let i = 0; i < this._headerSize; ++i) {
      heap[rawPtr + i] = 0;
    }
    this._setRefCount(rawPtr, 1);
    //heap[rawPtr + 2] = 1; // <- init refCount at 1 (from this allocation)
    heap[rawPtr + 3] = tag & 0b1111; // <- 4-bit tag
  }

  // [TODO] These next three methods can probably be made more efficient
  _getRefCount(userPtr) {
    trace('_getRefCount');
    let rawPtr = userPtr - this._headerSize;
    //let rawPtr = userPtr - 3;
    let heap = new Uint8Array(this._memory.buffer);
    trace(`\tas binary: ${this._toBinary(heap[rawPtr], 8, 8)}|${this._toBinary(heap[rawPtr + 1], 8, 8)}|${this._toBinary(heap[rawPtr + 2], 8, 8)}`)
    let count = heap[rawPtr] & 0b0111; // reserved bit should always be zero, but let's be safe
    count = count << 8;
    count = count | heap[rawPtr + 1];
    count = count << 8;
    count = count | heap[rawPtr + 2];
    trace(`\t${count}`);
    return count;
  }

  _getValueTag(userPtr) {
    trace('_getValueTag');
    let rawPtr = userPtr - this._headerSize;
    let heap = new Uint8Array(this._memory.buffer);
    return heap[rawPtr + 3];
  }

  _toHex(n, minWidth) {
    if (!TRACE_MEMORY) {
      return undefined; // improve performance; this is a very hot path in production
    }
    return toHex(n, minWidth);
  }

  _toBinary(n, minWidth, maxWidth) {
    if (!TRACE_MEMORY) {
      return undefined; // see above
    }
    let ret = toBinary(n, minWidth);
    if (maxWidth && ret.length > maxWidth) {
      if (ret.substring(0, ret.length - maxWidth).includes('1')) {
        console.warn('chopping off at least one 1!');
      }
      ret = ret.substring(ret.length - maxWidth);
    }
    return ret;
  }

  _memdump(userPtr) {
    let heap = new Uint8Array(this._memory.buffer);
    if (!TRACE_MEMORY) {
      return undefined; // improve performance; this is a very hot path in production
    }
    return `Dump: 0x${this._toHex(heap[userPtr-8])} 0x${this._toHex(heap[userPtr-7])} 0x${this._toHex(heap[userPtr-6])} 0x${this._toHex(heap[userPtr-5])} 0x${this._toHex(heap[userPtr-4])} 0x${this._toHex(heap[userPtr-3])} 0x${this._toHex(heap[userPtr-2])} 0x${this._toHex(heap[userPtr-1])} @ 0x${this._toHex(userPtr)} (raw: 0x${this._toHex(userPtr - this._headerSize)})`
  }

  decRef64(userPtr) {
    trace('decRef64 [see next]');
    if (TRACE_MEMORY) {
      this._decRefSources[userPtr] = this._decRefSources[userPtr] || {};
      this._decRefSources[userPtr]['64']++;
    }
    return this.decRef(userPtr);
  }

  incRef64(userPtr) {
    trace('incRef64 [see next]');
    return this.incRef(userPtr, '64');
  }

  incRefADT(userPtr) {
    trace('incRefADT [see next]');
    return this.incRef(userPtr, 'ADT');
  }

  incRefArray(userPtr) {
    trace('incRefARRAY [see next]');
    return this.incRef(userPtr, 'ARRAY');
  }

  decRefArray(userPtr) {
    trace('decRefArray [see next]');
    return this.decRef(userPtr, 'ARRAY');
  }

  incRefTuple(userPtr) {
    trace('incRefTuple [see next]');
    return this.incRef(userPtr, 'TUPLE');
  }

  decRefTuple(userPtr) {
    trace('decRefTuple [see next]');
    return this.decRef(userPtr, 'TUPLE');
  }

  incRefBox(userPtr) {
    trace('incRefBox [see next]');
    return this.incRef(userPtr, 'BOX');
  }

  decRefBox(userPtr) {
    trace('decRefBox [see next]');
    return this.decRef(userPtr, 'BOX');
  }

  incRefBackpatch(userPtr) {
    trace('incRefBackpatch [see next]');
    return this.incRef(userPtr, 'BACKPATCH');
  }

  incRefSwapBind(userPtr) {
    trace('incRefSwapBind [see next]');
    return this.incRef(userPtr, 'SWAP');
  }

  decRefSwapBind(userPtr) {
    trace('decRefSwapBind [see next]');
    return this.decRef(userPtr, 'SWAP');
  }

  incRefArgBind(userPtr) {
    trace('incRefArgBind [see next]');
    return this.incRef(userPtr, 'ARG');
  }

  decRefArgBind(userPtr) {
    trace('decRefArgBind [see next]');
    return this.decRef(userPtr, 'ARG');
  }

  incRefLocalBind(userPtr) {
    trace('incRefLocalBind [see next]');
    return this.incRef(userPtr, 'LOCAL');
  }

  decRefLocalBind(userPtr) {
    trace('decRefLocalBind [see next]');
    return this.decRef(userPtr, 'LOCAL');
  }

  incRefGlobalBind(userPtr) {
    trace('incRefGlobalBind [see next]');
    return this.incRef(userPtr, 'GLOBAL');
  }

  decRefGlobalBind(userPtr) {
    trace('decRefGlobalBind [see next]');
    return this.decRef(userPtr, 'GLOBAL');
  }

  incRefClosureBind(userPtr) {
    trace('incRefClosureBind [see next]');
    return this.incRef(userPtr, 'CLOSURE');
  }

  decRefClosureBind(userPtr) {
    trace('decRefClosureBind [see next]');
    return this.decRef(userPtr, 'CLOSURE');
  }

  incRefCleanupLocals(userPtr) {
    trace('incRefCleanupLocals [see next]');
    return this.incRef(userPtr, 'CLEANUP_LOCALS');
  }

  decRefCleanupLocals(userPtr, slot) {
    trace(`decRefCleanupLocals <slot: ${slot}> [see next]`);
    return this.decRef(userPtr, 'CLEANUP_LOCALS', true);
  }

  decRefCleanupGlobals(userPtr) {
    trace('decRefCleanupGlobals [see next]');
    return this.decRef(userPtr, 'CLEANUP_GLOBALS', true);
  }

  decRefDrop(userPtr) {
    trace('decRefDrop [see next]');
    return this.decRef(userPtr, 'DROP', true);
  }

  _markIncRefSource(userPtr, x) {
    if (TRACE_MEMORY) {
      this._incRefSources[userPtr] = this._incRefSources[userPtr] || {};
      this._incRefSources[userPtr][x] = (this._incRefSources[userPtr][x] || 0) + 1;
    }
  }

  _markDecRefSource(userPtr, x) {
    if (TRACE_MEMORY) {
      this._decRefSources[userPtr] = this._decRefSources[userPtr] || {};
      this._decRefSources[userPtr][x] = (this._decRefSources[userPtr][x] || 0) + 1;
    }
  }

  _setRefCount(rawPtr, count) {
    const heap = new Uint8Array(this._memory.buffer);
    trace('_setRefCount:')
    trace(`\told as binary: ${this._toBinary(heap[rawPtr], 8, 8)}|${this._toBinary(heap[rawPtr + 1], 8, 8)}|${this._toBinary(heap[rawPtr + 2], 8, 8)}`)
    heap[rawPtr] = (count & (0b01111111 << 16)) >> 16;
    heap[rawPtr + 1] = (count & (0b11111111 << 8)) >> 8;
    heap[rawPtr + 2] = count & 0b11111111;
    trace(`\tnew as binary: ${this._toBinary(heap[rawPtr], 8, 8)}|${this._toBinary(heap[rawPtr + 1], 8, 8)}|${this._toBinary(heap[rawPtr + 2], 8, 8)}`)
  }

  incRef(userPtr, src) {
    let origInput = userPtr;
    trace(`incRef(0x${this._toHex(userPtr)})`);
    let ptrTagType = getTagType(userPtr, true);
    if (userPtr === 0 || ptrTagType === GRAIN_NUMBER_TAG_TYPE || ptrTagType === GRAIN_CONST_TAG_TYPE) {
      // no ref-counting for primitives
      // [TODO] The type-checker should make this not ever be called ideally, but it
      //        significantly complicates our codegen
      trace(`\tbailing out (ptrTagType: ${ptrTagType})`);
      return origInput;
    }
    userPtr = userPtr & (~7);
    if (TRACE_MEMORY) {
      this._knownTagTypes[userPtr] = ptrTagType;
      let heapTag = '';
      if (ptrTagType === GRAIN_GENERIC_HEAP_TAG_TYPE) {
        heapTag = `>${heapTagToString(new Uint32Array(this._memory.buffer)[userPtr/4])}`
      }
      trace(`\ttrue ptr: 0x${this._toHex(userPtr)} (${tagToString(ptrTagType)}${heapTag} (${ptrTagType})); raw: 0x${this._toHex(userPtr - this._headerSize)}`);
    }
    this._markIncRefSource(userPtr, src || 'UNK');
    trace('\tincrementing...');
    let rawPtr = userPtr - this._headerSize;
    let refCount = this._getRefCount(userPtr);
    ++refCount;
    trace(`\tnew count: ${refCount}`);
    this._setRefCount(rawPtr, refCount);
    trace(`\tdump: ${this._memdump(userPtr)}`);
    return origInput;
  }

  *references(userPtr) {
    const view = new Int32Array(this._memory.buffer);
    const ptrTagType = getTagType(userPtr, true);
    switch (ptrTagType) {
      case GRAIN_TUPLE_TAG_TYPE:
        let tupleIdx = userPtr / 4;
        let tupleLength = view[tupleIdx];
        if (tupleLength & 0x80000000) {
          // cyclic. return
          return;
        } else {
          view[tupleIdx] |= 0x80000000;
          trace(`traversing ${tupleLength} tuple elts`);
          for (let i = 0; i < tupleLength; ++i) {
            //this.decRef(view[tupleIdx + i + 1], 'FREE')
            yield view[tupleIdx + i + 1];
          }
          view[tupleIdx] = tupleLength;
        }
        break;
      case GRAIN_LAMBDA_TAG_TYPE:
        // 4 * (idx + 3)
        let lambdaIdx = userPtr / 4;
        let numFreeVars = view[lambdaIdx + 2];
        trace(`traversing ${numFreeVars} free vars`);
        for (let i = 0; i < numFreeVars; ++i) {
          //this.decRef(view[lambdaIdx + 3 + i], 'FREE');
          yield view[lambdaIdx + 3 + i];
        }
        break;
      case GRAIN_GENERIC_HEAP_TAG_TYPE:
        let genericHeapValUserPtr = userPtr;
        switch (view[genericHeapValUserPtr / 4]) {
          case GRAIN_ADT_HEAP_TAG:
            if (this._runtime) {
              let x = genericHeapValUserPtr / 4;
              let [variantName, arity] = grainAdtInfo(this._runtime, genericHeapValUserPtr);
              trace(`traversing ${arity} ADT vals`);
              for (let i = 0; i < arity; ++i) {
                //this.decRef(view[x + 5 + i], 'FREE');
                yield view[x + 5 + i];
              }
            }
          default:
            // No extra traversal needed for Strings and DOM elements
        }
        break;
      default:
        console.warn(`<decRef: Unexpected value tag: 0x${this._toHex(ptrTagType)}> [userPtr=0x${this._toHex(userPtr)}]`)
    }
  }

  recolor(userPtr, color, ignoreZeros) {
    this._colors[userPtr] = this._colors[userPtr] || GREEN;
    if (this._colors[userPtr] == color) {
      // fast case
      return;
    }
    for (let childUserPtr of this.references(userPtr)) {
      if (this._colors[userPtr] === GREEN && color !== GREEN) {
        this.decRef(childUserPtr, 'RECOLOR', ignoreZeros);
      } else if (this._colors[userPtr] !== GREEN && color === GREEN) {
        this.incRef(childUserPtr, 'RECOLOR');
      }
    }
    this._colors[userPtr] = color;
  }

  decRef(userPtr, src, ignoreZeros) {
    // [TODO] This does not properly handle cycles yet!!
    trace(`decRef(0x${this._toHex(userPtr)})`);
    let origInput = userPtr;
    let ptrTagType = getTagType(userPtr, true);
    if (userPtr === 0 || ptrTagType === GRAIN_NUMBER_TAG_TYPE || ptrTagType === GRAIN_CONST_TAG_TYPE) {
      // no ref-counting for primitives
      // [TODO] The type-checker should make this not ever be called ideally, but it
      //        significantly complicates our codegen
      trace(`\tbailing out (ptrTagType: ${ptrTagType})`);
      return origInput;
    }
    userPtr = userPtr & (~7);
    if (TRACE_MEMORY) {
      let heapTag = '';
      if (ptrTagType === GRAIN_GENERIC_HEAP_TAG_TYPE) {
        heapTag = `>${heapTagToString(new Uint32Array(this._memory.buffer)[userPtr/4])}`
      }
      trace(`\ttrue ptr: 0x${this._toHex(userPtr)} (${tagToString(ptrTagType)}${heapTag} (${ptrTagType})); raw: 0x${this._toHex(userPtr - this._headerSize)}`);
    }
    this._markDecRefSource(userPtr, src || 'UNK');
    let heap = new Uint8Array(this._memory.buffer);
    let rawPtr = userPtr - this._headerSize;
    let refCount = this._getRefCount(userPtr);
    // [TODO] This is a blazing-hot code path. Should we eschew error-checking?
    if (refCount === 0) {
      if (ignoreZeros) {
        trace('ignoring zero refcount');
        return userPtr;
      }
      throw new Error(`decRef called when reference count was zero. ${this._memdump(userPtr)}`);
    }
    --refCount;
    trace('\tdecrementing...');
    trace(`\tnew count: ${refCount}`);
    if (refCount === 0) {
      // This object is ready to be freed.
      let view = new Int32Array(heap);
      trace("Should traverse elements and decref() here!")
      switch (ptrTagType) {
        case GRAIN_TUPLE_TAG_TYPE:
          let tupleIdx = userPtr / 4;
          let tupleLength = view[tupleIdx];
          if (tupleLength & 0x80000000) {
            // cyclic. return
            return origInput;
          } else {
            view[tupleIdx] |= 0x80000000;
            trace(`traversing ${tupleLength} tuple elts`);
            for (let i = 0; i < tupleLength; ++i) {
              this.decRef(view[tupleIdx + i + 1], 'FREE')
            }
            view[tupleIdx] = tupleLength;
          }
          break;
        case GRAIN_LAMBDA_TAG_TYPE:
          // 4 * (idx + 3)
          let lambdaIdx = userPtr / 4;
          let numFreeVars = view[lambdaIdx + 2];
          trace(`traversing ${numFreeVars} free vars`);
          for (let i = 0; i < numFreeVars; ++i) {
            this.decRef(view[lambdaIdx + 3 + i], 'FREE');
          }
          break;
        case GRAIN_GENERIC_HEAP_TAG_TYPE:
          let genericHeapValUserPtr = userPtr;
          switch (view[genericHeapValUserPtr / 4]) {
            case GRAIN_ADT_HEAP_TAG:
              if (this._runtime) {
                let x = genericHeapValUserPtr / 4;
                let [variantName, arity] = grainAdtInfo(this._runtime, genericHeapValUserPtr);
                trace(`traversing ${arity} ADT vals`);
                for (let i = 0; i < arity; ++i) {
                  this.decRef(view[x + 5 + i], 'FREE');
                }
              }
            default:
              // No extra traversal needed for Strings and DOM elements
          }
          break;
        default:
          console.warn(`<decRef: Unexpected value tag: 0x${this._toHex(ptrTagType)}> [userPtr=0x${this._toHex(userPtr)}]`)
      }
      this._setRefCount(rawPtr, refCount);
      this.free(userPtr);
    } else {
      this._setRefCount(rawPtr, refCount);
    }
    return origInput;
  }

  free(userPtr) { // [TODO] Do we even need this?
    // stub
    trace(`free 0x${(new Number(userPtr)).toString(16)}`);
    trace(this._memdump(userPtr));
    if (TRACE_MEMORY) {
      trace(`\tincrefs: ${JSON.stringify(this._incRefSources[userPtr] || {})}`);
      trace(`\tdecrefs: ${JSON.stringify(this._decRefSources[userPtr] || {})}`);
      if (this._freedAddresses.has(userPtr)) {
        throw 'Double free!';
      }
    }
    this._mallocModule.free(userPtr - this._headerSize);
    if (TRACE_MEMORY) {
      this._allocatedAddresses.delete(userPtr);
      this._freedAddresses.add(userPtr);
      this._timesFreed[userPtr] = (this._timesFreed[userPtr] || 0) + 1;
    }
    trace('end_free');
  }

  _numAllocations() {
    let ret = 0;
    for (let elt of Object.values(this._timesAllocated)) {
      ret += elt;
    }
    return ret;
  }

  _numFrees() {
    let ret = 0;
    for (let elt of Object.values(this._timesFreed)) {
      ret += elt;
    }
    return ret;
  }

  prepareExit() {
    // Prints debug info for memory tracing before the interpreter exits
    if (!TRACE_MEMORY) {
      return;
    }
    trace('==== MEMORY TRACE INFO ===');
    trace(`Max used span size: ${this._maxAddress - this._minAddress}`);
    trace(`Objects allocated:  ${this._numAllocations()}`);
    trace(`Objects freed:      ${this._numFrees()}`);
    trace(`Objects leaked:     ${this._allocatedAddresses.size}`);
    trace('---- LEAKED OBJECTS ---');
    this._allocatedAddresses.forEach((x) => {
      let ptrTagType = this._knownTagTypes[x] || -1;
      if (x === 0 || ptrTagType === GRAIN_NUMBER_TAG_TYPE || ptrTagType === GRAIN_CONST_TAG_TYPE) {
        trace(`is invalid (ptrTagType=${ptrTagType} (${ptrTagType === GRAIN_NUMBER_TAG_TYPE ? 'number' : ''}${ptrTagType === GRAIN_CONST_TAG_TYPE ? 'const' : ''}))`)
      }
      // if (ptrTagType === GRAIN_LAMBDA_TAG_TYPE) {
      //   return;
      // }
      trace(this._memdump(x));
      let heapTag = '';
      if (ptrTagType === GRAIN_GENERIC_HEAP_TAG_TYPE) {
        heapTag = `>${heapTagToString(new Uint32Array(this._memory.buffer)[x/4])}`
      } else if (ptrTagType === GRAIN_LAMBDA_TAG_TYPE) {
        heapTag = `[${new Uint32Array(this._memory.buffer)[(x/4) + 2]} free vars]`
      } else if (ptrTagType === GRAIN_TUPLE_TAG_TYPE) {
        heapTag = `[${new Uint32Array(this._memory.buffer)[(x/4)]} elts]`
      }
      trace(`last known tag: ${tagToString(ptrTagType)}${heapTag} (${ptrTagType})`)
      this._getRefCount(x);
      trace(`\tincrefs: ${JSON.stringify(this._incRefSources[x] || {})}`);
      trace(`\tdecrefs: ${JSON.stringify(this._decRefSources[x] || {})}`);
    });
    // trace('---- LEAKED OBJECTS (2) ---');
    // Object.keys(this._incRefSources).forEach((x) => {
    //   trace(this._memdump(x));
    //   this._getRefCount(x);
    //   trace(`\tincrefs: ${JSON.stringify(this._incRefSources[x] || {})}`);
    //   trace(`\tdecrefs: ${JSON.stringify(this._decRefSources[x] || {})}`);
    // })
    trace('==== END MEMORY TRACE INFO ===')
  }
}

class ManagedType {
  constructor(name, initializer, finalizer, to_string, equals, tag) {
    this._name = name;
    this._initializer = initializer;
    this._finalizer = finalizer;
    this._to_string = to_string;
    this._equals = equals;
    this._tag = tag;
  }

  get name() {
    return this._name;
  }

  get tag() {
    return this._tag;
  }

  initialize(memory, address) {
    if (this._initializer) {
      this._initializer(memory, address);
    }
  }

  finalize(memory, address) {
    if (this._finalizer) {
      this._finalizer(memory, address);
    }
  }

  to_string(memory, address) {
    if (this._to_string) {
      return this._to_string(memory, address);
    }
    return `#<Instance: ${this.name}>`;
  }

  equals(memory, address1, address2) {
    if (this._equals) {
      return this._equals(memory, address1, address2);
    }
    return address1 === address2;
  }
}


