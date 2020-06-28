#!/bin/sh
// 2>/dev/null; exec /usr/bin/env node --experimental-wasm-bigint "$0" "$@"
// https://github.com/grain-lang/grain/issues/114

const { execSync } = require('child_process');
const path = require('path');

let program = require('commander');
let compile = require('./compile.js');
let run = require('./run.js');

let pervasivesPath = require.resolve('@grain/stdlib');
let stdlibPath = path.dirname(pervasivesPath);

let givenFile

function list(val) {
  return val.split(',');
}

function num(val) {
  return Number.parseInt(val, 10);
}

function graincVersion() {
  const grainc = path.join(__dirname, 'grainc.exe');

  return execSync(`${grainc} --version`).toString().trim();
}

program
  .option('-v, --version', 'output CLI and compiler versions')
  .on('option:version', () => {
    console.log(`Grain cli ${require('../package.json').version}`)
    console.log(`Grain compiler ${graincVersion()}`)
    process.exit(0)
  })
  .description('Compile and run Grain programs. 🌾')
  .arguments('<file>')
  .option('-w, --wasm', 'run a wasm file')
  .option('-p, --print-output', 'print the output of the program')
  .option('-g, --graceful', 'return a 0 exit code if the program errors')
  .option('-I, --include-dirs <dirs>', 'include directories the runtime should find wasm modules', list, [])
  .option('-f, --cflags <cflags>', 'pass flags to the Grain compiler')
  .option('-S, --stdlib <path>', 'override the standard libary with your own', stdlibPath)
  .option('--limitMemory <size>', 'maximum allowed heap size', num, -1)
  .action((file) => {
    givenFile = file

    let wasmFile;
    if (program.wasm) {
      wasmFile = file;
    } else {
      wasmFile = compile(file, program);
    }

    run(wasmFile, program);
  });

program.parse(process.argv);

// If no file is given, print the help message and exit
if (typeof givenFile === 'undefined') {
  program.outputHelp()
  process.exit(-1)
}
