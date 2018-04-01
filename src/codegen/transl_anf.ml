open Grain_parsing
open Grain_typed
open Grain_middle_end

open Asttypes
open Anftree
open Mashtree

type compilation_env = {
  ce_binds: Mashtree.binding Ident.tbl;
  (* Useful due to us needing a second pass over exports (for mutual recursion) *)
  ce_exported_globals: int32 Ident.tbl;
  ce_stack_idx: int;
  ce_arity: int;
}

let initial_compilation_env = {
  ce_binds = Ident.empty;
  ce_exported_globals = Ident.empty;
  ce_stack_idx = 0;
  ce_arity = 0;
}

type worklist_elt = {
  body : anf_expression;
  env : compilation_env;
  arity : int;
  idx : int; (* Lambda-lifted index *)
  stack_size : int;
}

let compilation_worklist = ref (BatDeque.empty : worklist_elt BatDeque.t)

(** Lambda-lifting index (function index) *)
let lift_index = ref 0

let reset_lift() =
  lift_index := 0

let next_lift() =
  let ret = !lift_index in
  lift_index := ret + 1;
  ret

(** Global index (index of global variables) *)
let global_table = ref (Ident.empty : int32 Ident.tbl)
let global_index = ref 0

let global_exports() =
  let tbl = !global_table in
  Ident.fold_all (fun ex_name ex_global_index acc -> {ex_name; ex_global_index}::acc) tbl []

let reset_global() =
  global_table := Ident.empty;
  global_index := 0

let next_global id =
  let ret = !global_index in
  global_table := Ident.add id (Int32.of_int ret) !global_table;
  global_index := ret + 1;
  ret

let find_id id env = Ident.find_same id env.ce_binds
let find_global id env = Ident.find_same id env.ce_exported_globals


let worklist_reset () = compilation_worklist := BatDeque.empty
let worklist_enqueue elt = compilation_worklist := BatDeque.snoc !compilation_worklist elt
let worklist_empty () = BatDeque.is_empty !compilation_worklist
let worklist_pop () =
  match BatDeque.front !compilation_worklist with
  | None -> raise Not_found
  | Some(hd, tl) ->
    compilation_worklist := tl;
    hd

let compile_const (c : Asttypes.constant) =
  match c with
  | Const_int i -> MConstI32 (Int32.of_int i)
  | Const_string _ -> failwith "NYI: compile_const string"
  | Const_float f_str -> failwith "NYI: compile_const float"
  | Const_int32 i32 -> MConstI32 i32
  | Const_int64 i64 -> MConstI64 i64
  | Const_bool b when b = true -> const_true
  | Const_bool _ -> const_false

let compile_imm env (i : imm_expression) =
  match i.imm_desc with
  | ImmConst c -> MImmConst(compile_const c)
  | ImmId id -> MImmBinding(find_id id env)


let compile_lambda env args body : Mashtree.closure_data =
  let used_var_set = Anf_utils.anf_free_vars body in
  let free_var_set = Ident.Set.diff used_var_set @@ Ident.Set.of_list args in
  let free_vars = Ident.Set.elements free_var_set in
  (* Bind all non-arguments in the function body to
     their respective closure slots *)
  let free_binds = BatList.fold_lefti (fun acc closure_idx var ->
      Ident.add var (MClosureBind(Int32.of_int closure_idx)) acc)
      Ident.empty free_vars in
  let closure_arg = Ident.create "$self" in
  let new_args = closure_arg::args in
  let arg_binds = BatList.fold_lefti (fun acc arg_idx arg ->
      Ident.add arg (MArgBind(Int32.of_int arg_idx)) acc)
      free_binds new_args in
  let idx = next_lift() in
  let arity = List.length new_args in
  let stack_size = Anf_utils.anf_count_vars body in
  let lam_env = {
    env with
    ce_binds=arg_binds;
    ce_stack_idx=0;
    ce_arity=arity;
  } in
  let worklist_item = {
    body;
    env=lam_env;
    idx;
    arity;
    stack_size;
  } in
  worklist_enqueue worklist_item;
  {
    func_idx=(Int32.of_int idx);
    arity=(Int32.of_int arity);
    (* These variables should be in scope when the lambda is constructed. *)
    variables=(List.map (fun id -> MImmBinding(find_id id env)) free_vars);
  }


let rec compile_comp env c =
  match c.comp_desc with
  | CSwitch(arg, branches) ->
    let compiled_arg = compile_imm env arg in
    MSwitch(compiled_arg,
            List.map (fun (lbl, body) ->
                (Int32.of_int lbl, compile_anf_expr env body)) branches,
            [MError(Runtime_errors.SwitchError, [compiled_arg])])
  | CIf(cond, thn, els) ->
    MIf(compile_imm env cond, compile_anf_expr env thn, compile_anf_expr env els)
  | CPrim1(p1, arg) ->
    MPrim1(p1, compile_imm env arg)
  | CPrim2(p2, arg1, arg2) ->
    MPrim2(p2, compile_imm env arg1, compile_imm env arg2)
  | CTuple(args) ->
    MAllocate(MTuple (List.map (compile_imm env) args))
  | CString(s) ->
    MAllocate(MString s)
  | CGetTupleItem(idx, tup) ->
    MTupleOp(MTupleGet(idx), compile_imm env tup)
  | CSetTupleItem(idx, tup, value) ->
    MTupleOp(MTupleSet(idx, compile_imm env value), compile_imm env tup)
  | CLambda(args, body) ->
    MAllocate(MClosure(compile_lambda env args body))
  | CApp(f, args) ->
    (* TODO: Utilize MCallKnown *)
    MCallIndirect(compile_imm env f, List.map (compile_imm env) args)
  | CImmExpr(i) -> MImmediate(compile_imm env i)

and compile_anf_expr env a =
  match a.anf_desc with
  | AESeq(hd, tl) -> (compile_comp env hd)::(compile_anf_expr env tl)
  | AELet(global, recflag, binds, body) ->
    let get_loc idx (id, _) =
      match global with
      | Global -> MGlobalBind(Int32.of_int (next_global id))
      | Nonglobal -> MLocalBind(Int32.of_int (env.ce_stack_idx + idx)) in
    let locations = List.mapi get_loc binds in
    let new_env = BatList.fold_left2 (fun acc new_loc (id, _) ->
        {acc with ce_binds=Ident.add id new_loc acc.ce_binds; ce_stack_idx=acc.ce_stack_idx + 1})
        env locations binds in
    begin match recflag with
      | Nonrecursive ->
        BatList.fold_right2 (fun loc (_, rhs) acc ->
            (MStore [loc, (compile_comp env rhs)]) :: acc)
          locations binds (compile_anf_expr new_env body)
      | Recursive ->
        let binds = BatList.fold_left2 (fun acc loc (_, rhs) ->
            (loc, (compile_comp new_env rhs)) :: acc)
            [] locations binds in
        MStore(List.rev binds) :: (compile_anf_expr new_env body)
    end
  | AEComp(c) -> [compile_comp env c]


let compile_worklist_elt ({body; env} : worklist_elt) =
  compile_anf_expr env body


let fold_left_pop f base =
  let rec help acc =
    if worklist_empty() then
      acc
    else
      help (f acc (worklist_pop())) in
  help base


let compile_remaining_worklist () =
  let compile_one funcs ((({idx=index; arity; stack_size}) as cur) : worklist_elt) =
    let body = compile_worklist_elt cur in
    let func = {
      index=Int32.of_int index;
      arity=Int32.of_int arity;
      body;
      stack_size;
    } in
    func::funcs in
  List.rev (fold_left_pop compile_one [])


let transl_anf_program (anf_prog : Anftree.anf_program) : Mashtree.mash_program =
  reset_lift();
  reset_global();
  worklist_reset();

  let main_body_stack_size = Anf_utils.anf_count_vars anf_prog.body in
  let main_body = compile_anf_expr initial_compilation_env anf_prog.body in
  let imports = [] in
  let exports = global_exports() in
  let functions = compile_remaining_worklist() in

  {
    functions;
    imports;
    exports;
    main_body;
    main_body_stack_size;
    num_globals=(!global_index);
  }

