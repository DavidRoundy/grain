<div align="center">
    <a href="https://grain-lang.org/">
        <img src="https://raw.githubusercontent.com/grain-lang/grain/master/grain_shorthand_color.svg" alt="Grain" height="200" />
    </a>
</div>

[![License: LGPL v3](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)
[![GitHub version](https://badge.fury.io/gh/grain-lang%2Fgrain.svg)](https://badge.fury.io/gh/grain-lang%2Fgrain)

# The Grain Compiler

Grain is a strongly-typed functional programming language built for the modern web by leveraging the brilliant work done by the [WebAssembly project](http://webassembly.org/).

This language is still a work in progress, but be sure to stay tuned, or even contribute!

For more information about the language, visit [grain-lang.org](https://grain-lang.org/).

## Building

### Compiler

To build the compiler, have `ocaml` (version = 4.08) and `opam` (version >= 2.0) installed and on your path. Then,

```bash
# If needed, make sure you have OCaml 4.08 enabled
$ opam switch 4.08.1
# Then install dependencies and build
$ opam install . --deps-only
$ make
```

Running `make install` will symlink `grainc` onto your PATH.

You can run the tests with `make tests`.

### Runtime

To build the runtime, have `node` (version >= 9) and `npm` (version >= 5) installed. Then,

```bash
$ cd runtime
$ npm install
$ npm run build
```

### CLI

To make the CLI available on your path, have `node` (version >= 9) and `npm` (version >= 5) installed. Then,

```bash
$ cd cli
$ npm install
$ npm link --global
```

## Running

To create a `.wasm` file, run the following:

```bash
$ grainc /path/to/file.gr -o /path/to/output.wasm
```

For an example of how to run the file in JavaScript, look at the
files under `script`.
You'll need to create a symlink from `script/public/javascripts/grain-runtime.js` to the built file in `runtime/dist/grain-runtime.js`, or you'll have to just copy it over to run the example.

Alternatively, you can use the CLI to run your program on Node:

```bash
$ grain test.gr
```

Copyright ©️ 2017-2020 Philip Blair and Oscar Spencer.

[philip]: https://github.com/belph
[oscar]: http://github.com/ospencer
[wasm]: http://webassembly.org/
