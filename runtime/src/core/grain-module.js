import fs from 'fs';
import { GrainError } from '../errors/errors';
import { grainToJSVal } from '../utils/utils';

export class GrainModule {
  constructor(wasmModule, name) {
    this.wasmModule = wasmModule;
    this.name = name; // name is optional
    this._instantiated = null;
  }

  get isInstantiated() {
    return this._instantiated !== null;
  }

  get instantiated() {
    if (!this.isInstantiated) {
      throw new GrainError(-1, `Module${this.name ? (" " + this.name) : ""} must be instantiated before use`);
    }
    return this._instantiated;
  }

  get importSpecs() {
    return WebAssembly.Module.imports(this.wasmModule);
  }

  get exportSpecs() {
    return WebAssembly.Module.exports(this.wasmModule);
  }

  // TODO: This is a low-level function. There should be convenience
  //       accessors for runtime-required custom binary sections.
  get customSections() {
    return WebAssembly.Module.customSections(this.wasmModule);
  }

  get exports() {
    return this.instantiated.exports;
  }

  requiredExport(key) {
    let exports = this.exports;
    if (!(key in exports)) {
      throw new Error(`Module ${this.name} missing required export: ${key}`);
    }
    return exports[key];
  }

  get main() {
    return this.requiredExport("GRAIN$MAIN");
  }

  get tableSize() {
    return this.requiredExport("GRAIN$TABLE_SIZE");
  }

  async instantiate(importObj) {
    /*console.log(`Instantiating ${this.name}`);
    console.log(`imports:`);
    Object.keys(importObj).forEach(m => {
      console.log(`\timports[${m}]:`);
      let mod = importObj[m];
      Object.keys(mod).forEach(v => {
        let val = mod[v];
        let valstr = (val instanceof Function || typeof val === 'function') ? '<function>' : val;
        console.log(`\t\t${m}.${v}: ${valstr}`);
      });
      console.log('');
    });*/
    this._instantiated = await WebAssembly.instantiate(this.wasmModule, importObj);
    //console.log(`Instantiated: ${this._instantiated}.`);
    //console.log(`fields: ${Object.keys(this._instantiated)}`);
  }

  async run() {
    //console.log(`Running ${this.name}`);
    let res = await this.main();
    //console.log(`complete.`);
    return grainToJSVal(res);
  }
}

export async function readFile(path) {
  let modname = path.replace(/\.gr\(lib\)?$/, '').replace(/.*\/([^/]+)/, '$1');
  //console.log(`Reading module '${modname}' from file: ${path}`);
  let module = await WebAssembly.compile(fs.readFileSync(path));
  return new GrainModule(module, modname);
}

export async function readURL(url) {
  let modname = url; // FIXME
  console.log(`Reading module at URL: ${url}`);
  let response = await fetch(url);
  if (!response.ok) throw new Error(`[Grain] Could not load ${url} due to a network error.`);
  let module = await WebAssembly.compileStreaming(response);
  return new GrainModule(module, modname);
}
