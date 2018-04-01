open Unix
open Filename
open Str
open Compile
open Printf
open OUnit2
open ExtLib
open Lexing
open Grain_codegen

type ('a, 'b) either =
  | Left of 'a
  | Right of 'b

let either_printer e =
  match e with
  | Left(v) -> sprintf "Error: %s\n" v
  | Right(v) -> v

(* Read a file into a string *)
let string_of_file file_name =
  let inchan = open_in file_name in
  let buf = String.create (in_channel_length inchan) in
  really_input inchan buf 0 (in_channel_length inchan);
  buf 


let string_of_position p =
  sprintf "%s:line %d, col %d" p.pos_fname p.pos_lnum (p.pos_cnum - p.pos_bol);;


let print_errors exns =
  let open Wasm_runner in
  List.map (fun e ->
      match e with
      | GrainRuntimeError(msg) -> msg
      | _ ->
         sprintf "%s" (Printexc.to_string e)
    ) exns
;;


let parse name lexbuf =
  Grain_parsing.Driver.parse ~name lexbuf

let parse_string name s = 
  let lexbuf = Lexing.from_string s in
  parse name lexbuf

let parse_file name input_file = 
  let lexbuf = Lexing.from_channel input_file in
  parse name lexbuf

let compile_file_to_string name include_stdlib input_file =
  let input_program = parse_file name input_file in
  (compile_to_string include_stdlib input_program);;

let compile_string_to_string name include_stdlib s =
  let input_program = parse_string name s in
  (compile_to_string include_stdlib input_program);;

let compile_string_to_anf name opts s =
  let input_program = parse_string name s in
  (compile_to_anf opts input_program);;

let compile_string_to_final_anf name opts s =
  let input_program = parse_string name s in
  (compile_to_final_anf opts input_program);;

let make_tmpfiles name =
  let (null_stdin, _) = pipe() in
  let stdout_name = (temp_file ("stdout_" ^ name) ".out") in
  let stdin_name = (temp_file ("stderr_" ^ name) ".err") in
  (openfile stdout_name [O_RDWR] 0o600, stdout_name,
   openfile stdin_name [O_RDWR] 0o600, stdin_name,
   null_stdin)

let compile_file_to_assembly name include_stdlib input_file output_file =
  
  let asm = compile_file_to_string name include_stdlib input_file in
  let outstream = open_out output_file in
  output_string outstream asm;
  close_out outstream;
  asm

let safe_run_process prog args =
  let (pstdout, pstdout_name, pstderr, pstderr_name, pstdin) = make_tmpfiles ("proc_" ^ (Filename.basename prog)) in
  let ppid = Unix.create_process prog (Array.of_list ([prog] @ args)) pstdin pstdout pstderr in
  let (_, status) = waitpid [] ppid in
  let try_running = match status with
    | WEXITED 0 ->
      Right(string_of_file pstdout_name)
    | WEXITED n ->
      Left(sprintf "Finished with error while running %s:\n%s" prog (string_of_file pstderr_name))
    | WSIGNALED n ->
      Left(sprintf "Signalled with %d while running %s." n prog)
    | WSTOPPED n ->
      Left(sprintf "Stopped with signal %d while running %s." n prog) in
  let cleanup = fun() -> begin
      List.iter close [pstdout; pstderr; pstdin];
      List.iter unlink [pstdout_name; pstderr_name]
    end in
  try_running, cleanup

let assemble_object_file asm_file debug object_name =
  let rec get_encoded m =
    match m with
    | Wasm.Script.Textual m -> Wasm.Encode.encode m
    | Wasm.Script.Encoded(_, bs) -> bs
    | Wasm.Script.Quoted(_, s) -> get_encoded ((Wasm.Parse.string_to_module s).Wasm.Source.it) in
  let ic = open_in asm_file in
  let contents : Wasm.Script.definition = Wasm.Parse.string_to_module (input_all ic) in
  close_in ic;
  let oc = open_out_bin object_name in
  output_string oc @@ get_encoded (contents.Wasm.Source.it);
  close_out oc;
  "", (fun() -> ())

let compile_assembly_to_binary asm debug outfile_name =
  let asm_tmp_filename = if debug then outfile_name ^ ".wast" else (temp_file (Filename.basename outfile_name) ".wast") in
  let asm_tmp = open_out asm_tmp_filename in
  output_string asm_tmp asm;
  close_out asm_tmp;
  let obj_asm, obj_asm_cleanup = assemble_object_file asm_tmp_filename debug outfile_name in
  obj_asm

type result = (string, string) either

let run_no_vg (program_name : string) args : string =
  let (rstdout, rstdout_name, rstderr, rstderr_name, rstdin) = make_tmpfiles "run" in
  let ran_pid = Unix.create_process (program_name ^ ".run") (Array.of_list ([""] @ args)) rstdin rstdout rstderr in
  let (_, status) = waitpid [] ran_pid in
  let result =
    (try
       (match status with
        | WEXITED 0 -> string_of_file rstdout_name
        | WEXITED n -> failwith (sprintf "Error %d: %s" n (string_of_file rstderr_name))
        | WSIGNALED n ->
          failwith (sprintf "Signalled with %d while running %s." n program_name)
        | WSTOPPED n ->
          failwith (sprintf "Stopped with signal %d while running %s." n program_name))
     with exn ->
       begin
         List.iter close [rstdout; rstderr; rstdin];
         List.iter unlink [rstdout_name; rstderr_name];
         raise exn
       end) in
  List.iter close [rstdout; rstderr; rstdin];
  List.iter unlink [rstdout_name; rstderr_name];
  result

let run_asm asm_string out (runner : string -> string list  -> string) args =
  let outfile = open_out (out ^ ".wast") in
  fprintf outfile "%s" asm_string;
  close_out outfile;
  let (bstdout, bstdout_name, bstderr, bstderr_name, bstdin) = make_tmpfiles "build" in
  let built_pid = Unix.create_process "make" (Array.of_list [""; out ^ ".run"]) bstdin bstdout bstderr in
  let (_, status) = waitpid [] built_pid in

  (try
     (match status with
      | WEXITED 0 -> ignore(string_of_file bstdout_name)
      | WEXITED n -> failwith (sprintf "Error %d: %s" n (string_of_file bstderr_name))
      | WSIGNALED n ->
        failwith (sprintf "Signalled with %d while running %s." n out)
      | WSTOPPED n ->
        failwith (sprintf "Stopped with signal %d while running %s." n out))
   with exn ->
     begin
       List.iter close [bstdout; bstderr; bstdin];
       List.iter unlink [bstdout_name; bstderr_name];
       raise exn
     end);
  let result = runner out args in

  List.iter close [bstdout; bstderr; bstdin];
  List.iter unlink [bstdout_name; bstderr_name];
  result

  
let run include_stdlib p out runner args =
  let m = compile_module include_stdlib p in
  Wasm_runner.run_wasm m

let run_anf p out runner args =
  let asm_string = compile_prog p in
  run_asm asm_string out runner args


let compile_file_to_binary name include_stdlib debug input_file output_file =
  let asm = compile_file_to_string name include_stdlib input_file in
  compile_assembly_to_binary asm debug output_file


let test_run include_stdlib args program_str outfile expected test_ctxt =
  let full_outfile = "output/" ^ outfile in
  let program = parse_string outfile program_str in
  Wasm_runner.cur_modname := outfile;
  let result = run include_stdlib program full_outfile run_no_vg args in
  assert_equal (expected ^ "\n") result ~printer:identity

let test_run_anf include_stdlib args program_anf outfile expected test_ctxt =
  let full_outfile = "output/" ^ outfile in
  Wasm_runner.cur_modname := outfile;
  let result = run_anf program_anf full_outfile run_no_vg args in
  assert_equal (expected ^ "\n") result ~printer:identity

let test_err include_stdlib args program_str outfile errmsg test_ctxt =
  let full_outfile = "output/" ^ outfile in
  Wasm_runner.cur_modname := outfile;
  let program = parse_string outfile program_str in
  let result = try
      run include_stdlib program full_outfile run_no_vg args
    with exn -> Printexc.to_string exn
  in
  assert_equal
    errmsg
    result
    ~cmp: (fun check result -> String.exists result check)
    ~printer:identity
