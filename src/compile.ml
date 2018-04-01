open Grain_parsing
open Grain_typed
open Grain_middle_end
open Grain_codegen
open Optimize

type compile_options = {
  type_check: bool;
  verbose: bool;
  sound_optimizations: bool;
  optimizations_enabled: bool;
  include_dirs: string list;
  use_stdlib: bool;
}

let default_compile_options = {
  type_check = false;
  verbose = false;
  sound_optimizations = true;
  optimizations_enabled = true;
  include_dirs = [];
  use_stdlib = true;
}

let compile_prog p = Compcore.module_to_string @@ Compcore.compile_wasm_module p

let initial_funcs = [
  ("print", (Lexing.dummy_pos, Lexing.dummy_pos), false);
  ("equal", (Lexing.dummy_pos, Lexing.dummy_pos), true);
  ("toString", (Lexing.dummy_pos, Lexing.dummy_pos), true);
  ("input", (Lexing.dummy_pos, Lexing.dummy_pos), false);
  ("strcat", (Lexing.dummy_pos, Lexing.dummy_pos), true);
  ("strlen", (Lexing.dummy_pos, Lexing.dummy_pos), true);
  ("strslice", (Lexing.dummy_pos, Lexing.dummy_pos), true);
  ("DOM::query", (Lexing.dummy_pos, Lexing.dummy_pos), false);
  ("DOM::setText", (Lexing.dummy_pos, Lexing.dummy_pos), false);
  ("DOM::dangerouslySetInnerHTML", (Lexing.dummy_pos, Lexing.dummy_pos), false);
  ("DOM::addEventListener", (Lexing.dummy_pos, Lexing.dummy_pos), false);
]

(* Environment containing initial functions *)
(* Deprecated *)
let initial_load_env = List.map (fun (n, l, _) -> (n, l)) initial_funcs

(** List of standard libraries to load *)
let libs = ["lists"]

let opts_to_optimization_settings opts = {
  verbose = opts.verbose;
  sound = opts.sound_optimizations;
  (*initial_functions = initial_funcs;*)
}

let implicit_modules : string list ref = ref []

let open_implicit_module m env = env
  (*let open Grain_typed in
  let open Asttypes in
  let lid = {loc = Location.in_file "command line";
             txt = Longident.parse m } in
  snd (Typemod.type_open_ env lid.loc lid)**)

let initial_env () =
  let open Grain_typed in
  Ident.reinit();
  let initial = Env.initial_safe_string in
  let env = initial in
  List.fold_left (fun env m -> open_implicit_module m env) env (!implicit_modules)

let lib_include_dirs opts =
  (if opts.use_stdlib then Option.map_default (fun x -> [x]) [] (Grain_stdlib.stdlib_directory()) else []) @ opts.include_dirs

let compile_module (opts: compile_options) (p : Parsetree.parsed_program) =
  if !Grain_utils.Config.verbose then begin
    prerr_string "\nparsed program:\n";
    prerr_string @@ Sexplib.Sexp.to_string_hum @@ Grain_parsing.Parsetree.sexp_of_parsed_program p;
    prerr_string "\n\n";
  end;
  let full_p = Grain_stdlib.load_libraries p in
  if !Grain_utils.Config.verbose then begin
    prerr_string "\nwith libraries:\n";
    prerr_string @@ Sexplib.Sexp.to_string_hum @@ Grain_parsing.Parsetree.sexp_of_parsed_program full_p;
    prerr_string "\n\n";
  end;
  Well_formedness.check_well_formedness full_p;
  let typed_mod, signature, env = Typemod.type_module (initial_env()) full_p in
  if !Grain_utils.Config.verbose then begin
    prerr_string "\ntyped program:\n";
    prerr_string @@ Sexplib.Sexp.to_string_hum @@ Grain_typed.Typedtree.sexp_of_typed_program typed_mod;
    prerr_string "\n\n";
  end;
  let anfed = Linearize.transl_anf_module typed_mod in
  if !Grain_utils.Config.verbose then begin
    prerr_string "\nANFed program:\n";
    prerr_string @@ Sexplib.Sexp.to_string_hum @@ Anftree.sexp_of_anf_program anfed;
    prerr_string "\n\n";
  end;
  let optimized =
    if opts.optimizations_enabled then begin
      let ret = optimize_program anfed (opts_to_optimization_settings opts) in
      if !Grain_utils.Config.verbose then begin
        prerr_string "\nOptimized program:\n";
        prerr_string @@ Sexplib.Sexp.to_string_hum @@ Anftree.sexp_of_anf_program anfed;
        prerr_string "\n\n";
      end;
      ret
    end
    else
      anfed in
  let mashed = Transl_anf.transl_anf_program optimized in
  if !Grain_utils.Config.verbose then begin
    prerr_string "\nMashed program:\n";
    prerr_string @@ Sexplib.Sexp.to_string_hum @@ Mashtree.sexp_of_mash_program mashed;
    prerr_string "\n\n";
  end;
  Compcore.compile_wasm_module mashed

let compile_to_string opts p =
  Compcore.module_to_string @@ compile_module opts p

let compile_to_anf (opts : compile_options) (p : Parsetree.parsed_program) =
  let full_p = Grain_stdlib.load_libraries p in
  Well_formedness.check_well_formedness full_p;
  let typed_mod, signature, env = Typemod.type_module (initial_env()) full_p in
  let anfed = Linearize.transl_anf_module typed_mod in
  anfed

(* like compile_to_anf, but performs scope resolution and optimization. *)
let compile_to_final_anf (opts : compile_options) (p : Parsetree.parsed_program) =
  let full_p = Grain_stdlib.load_libraries p in
  Well_formedness.check_well_formedness full_p;
  let typed_mod, signature, env = Typemod.type_module (initial_env()) full_p in
  let anfed = Linearize.transl_anf_module typed_mod in
  let optimized =
    if opts.optimizations_enabled then
      optimize_program anfed (opts_to_optimization_settings opts)
    else
      anfed in
  optimized


let anf = Linearize.transl_anf_module

let free_vars anfed =
  Ident.Set.elements @@ Anf_utils.anf_free_vars anfed
