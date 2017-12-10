const GRAIN_TRUE = 0xFFFFFFFF | 0;
const GRAIN_FALSE = 0x7FFFFFFF | 0;

let grainInitialized = false;
let grainModule;
let grainDOMRefs = [];

let heapAdjust = function(n) {
  throw new GrainError(-1, "Grain runtime is not yet instantiated.");
};

function debugPrint(n) {
  // console.log(`0x${n.toString(16)} (0b${n.toString(2)})`);
  return n;
}

export const memory = new WebAssembly.Memory({initial: 1});
export const view = new Int32Array(memory.buffer);
export const encoder = new TextEncoder("utf-8");
export const decoder = new TextDecoder("utf-8");
let counter = 0;

var GrainClosure = function(loc) {
  this.loc = loc;
  this.arity = view[loc];
  this.ptr = view[loc + 1];
  this.closureSize = view[loc + 2];
  this.closureElts = view.slice(loc + 3, loc + 3 + this.closureSize);
  this.func = grainModule.instance.exports["GRAIN$LAM_" + this.ptr];
};

GrainClosure.prototype.call = function() {
  if (arguments.length != this.arity) {
    throwGrainError(GRAIN_ERR_ARITY_MISMATCH, this.arity, arguments.length);
    return undefined;
  } else {
    let grainVals = Array.prototype.map.call(arguments, JSToGrainVal);
    grainVals.unshift(this.loc * 4);
    return grainToJSVal(this.func.apply(this.func, grainVals));
  }
};

function printClosure(c) {
  c /= 4;
  let arity = view[c];
  let idx = view[c + 1];
  let closureSize = view[c + 2];
  let closureElts = [];

  for (var i = 0; i < closureSize; ++i) {
    closureElts.push(printNumber(view[c + i + 3]));
  }
  console.log(`<closure@${c}: idx=${idx}, arity=${arity}, size=${closureSize}: ${closureElts}>`);
  console.log(view.slice(0, 32));
  return c;
}

function grainEqualHelp(x, y, cycles) {
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
      if (!grainEqualHelp(view[xPtr + i + 1],
                          view[yPtr + i + 1],
                          cycles)) {
        result = false;
        break;
      }
    }
    view[xPtr] = length;
    view[yPtr] = length;
    return result;
  } else {
    return x === y;
  }
}

function grainEqual(x, y) {
  return grainEqualHelp(x, y, 0) ? GRAIN_TRUE : GRAIN_FALSE;
}

function grainCheckMemory(numBytes) {
  if (numBytes === 0) {
    return;
  }
  let curTop = heapAdjust(0);
  if (memory.buffer.byteLength - curTop < numBytes) {
    memory.grow(1);
  }
}

function grainHeapAllocate(numWords) {
  // allocates the number of words
  let curTop = heapAdjust(0);
  let wordsToAllocate = 4 * (Math.ceil((numWords - 1) / 4) + 1);
  heapAdjust(wordsToAllocate * 4);
  return curTop;
}

function grainDOMQuery(n) {
  assertString(n);
  let query = grainToJSVal(n);
  let elem = document.querySelector(query);
  if (elem) {
    grainDOMRefs.push(elem);
    let heapRef = grainHeapAllocate(2) / 4;
    view[heapRef] = GRAIN_DOM_ELEM_TAG;
    view[heapRef+1] = grainDOMRefs.length - 1;
    return (heapRef * 4) ^ 3;
  } else {
    return GRAIN_FALSE;
  }
}

function grainDOMElemSetText(elemRef, textRef) {
  assertDOMElement(elemRef);
  assertString(textRef);
  let elem = grainToJSVal(elemRef);
  elem.innerText = grainToJSVal(textRef);
  return elemRef;
}

function grainDOMDangerouslySetInnerHTML(elemRef, textRef) {
  assertDOMElement(elemRef);
  assertString(textRef);
  let elem = grainToJSVal(elemRef);
  elem.innerHTML = grainToJSVal(textRef);
  return elemRef;
}

function grainDOMAddEventListener(elemRef, eventRef, handlerRef) {
  assertDOMElement(elemRef);
  assertString(eventRef);
  assertLambda(handlerRef);
  let elem = grainToJSVal(elemRef);
  let event = grainToJSVal(eventRef);
  let handler = grainToJSVal(handlerRef);
  elem.addEventListener(event, () => handler.call());
  return elemRef;
}

function displayOnPage(str) {
  document.getElementById('output').innerText = str;
}

function printNumber(n) {
  debugPrint(n);
  let res = grainToString(n);
  displayOnPage(`${res}`);
  console.log(res);
  return n;
}



function stringAppend(s1, s2) {
  assertString(s1);
  assertString(s2);
  s1 = grainToJSVal(s1);
  s2 = grainToJSVal(s2);
  let appended = s1.concat(s2);
  let ret = JSToGrainVal(appended);
  return ret;
}

function stringLength(s) {
  assertString(s);
  return JSToGrainVal(grainToJSVal(s).length);
}

function stringSlice(s, from, to) {
  assertString(s);
  assertNumber(from);
  assertNumber(to);
  s = grainToJSVal(s);
  if (from < 0) {
    throwGrainError(GRAIN_ERR_NOT_NONNEG, from);
  } else if ((to >> 1) > s.length) {
    throw new GrainError(-1, `Index ${to >> 1} greater than string length (${s.length})`);
  }
  from = grainToJSVal(from);
  to = grainToJSVal(to);
  let ret = s.slice(from, to);
  return JSToGrainVal(ret);
}

const importObj = {
  console: {
    log: printNumber,
    debug: debugPrint,
    printClosure: printClosure
  },
  js: {
    mem: memory,
    throwError: throwGrainError,
    checkMemory: grainCheckMemory
  },
  grainBuiltins: {
    print: printNumber,
    equal: grainEqual,
    toString: (n => JSToGrainVal(grainToString(n))),
    stringAppend: stringAppend,
    stringLength: stringLength,
    stringSlice: stringSlice,
    DOMQuery: grainDOMQuery,
    DOMSetText: grainDOMElemSetText,
    DOMDangerouslySetInnerHTML: grainDOMDangerouslySetInnerHTML,
    DOMAddEventListener: grainDOMAddEventListener
  }
};

function fetchSource(url) {
  return fetch(url)
    .then(response => response.text())
    .then(code => {
      document.getElementById('sourceCode').innerText = code;
      Prism.highlightAll();
    });
}

function fetchAndInstantiate(url, importObject) {
  return fetch(url).then(response => response.arrayBuffer())
    .then(bytes => WebAssembly.instantiate(bytes, importObject))
    .then(results => results);
}

function runGrain(module) {
  grainModule = module;
  grainInitialized = true;
  let main = module.instance.exports["GRAIN$MAIN"];
  heapAdjust = module.instance.exports["GRAIN$HEAP_ADJUST"];
  let res = main();
  console.log(`result: ${res}`);
  let resJS = grainToJSVal(res);
  printNumber(res);
  return resJS;
}

function showError(e) {
  displayOnPage(`[[ERROR: ${e.message}]]`);
  console.error(e.message);
  console.error(e.stack);
  throw e;
}

var examples = {
  addition: { source: "adder.gr", wasm: "adder.wasm" },
  lambda: { source: "lambda.gr", wasm: "lambda.wasm" },
  dom: { source: "domSimple.gr", wasm: "domSimple.wasm" },
  domCb: { source: "dom.gr", wasm: "dom.wasm" }
};

function resetPage() {
  document.getElementById('div1').innerHTML = "";
  document.getElementById('div2').innerHTML = "";
  document.getElementById('innerDiv').innerHTML = "";
  document.getElementById('sourceCode').innerHTML = "";
}

export default function loadExample(e) {
  resetPage();
  fetchSource("examples/".concat(e.source));
  return fetchAndInstantiate("examples/".concat(e.wasm), importObj)
    .then(runGrain)
    .catch(showError);
}

function makeExampleLoader(e) {
  return () => loadExample(e);
}

document.getElementById("navAdd")
  .addEventListener("click", makeExampleLoader(examples.addition));
document.getElementById("navFunc")
  .addEventListener("click", makeExampleLoader(examples.lambda));
document.getElementById("navDOM")
  .addEventListener("click", makeExampleLoader(examples.dom));
document.getElementById("navDOMCallback")
  .addEventListener("click", makeExampleLoader(examples.domCb));

loadExample(examples.addition);
