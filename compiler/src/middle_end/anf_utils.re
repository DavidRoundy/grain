open Grain_parsing;
open Grain_typed;
open Anftree;

let rec anf_free_vars_help = (env, a: anf_expression) =>
  switch (a.anf_desc) {
  | AESeq(fst, rest) =>
    Ident.Set.union(
      comp_free_vars_help(env, fst),
      anf_free_vars_help(env, rest),
    )
  | AEComp(c) => comp_free_vars_help(env, c)
  | AELet(_, recflag, _, binds, body) =>
    let with_names =
      List.fold_left((acc, (id, _)) => Ident.Set.add(id, acc), env, binds);
    let free_binds =
      switch (recflag) {
      | Recursive =>
        List.fold_left(
          (acc, (_, body)) =>
            Ident.Set.union(acc, comp_free_vars_help(with_names, body)),
          Ident.Set.empty,
          binds,
        )
      | Nonrecursive =>
        List.fold_left(
          (acc, (_, body)) =>
            Ident.Set.union(acc, comp_free_vars_help(env, body)),
          Ident.Set.empty,
          binds,
        )
      };
    Ident.Set.union(free_binds, anf_free_vars_help(with_names, body));
  }

and comp_free_vars_help = (env, c: comp_expression) =>
  switch (c.comp_desc) {
  | CLambda(_, args, (body, _)) =>
    anf_free_vars_help(
      Ident.Set.union(
        env,
        Ident.Set.of_list(List.map(((arg, _)) => arg, args)),
      ),
      body,
    )
  | CIf(cond, thn, els) =>
    Ident.Set.union(imm_free_vars_help(env, cond)) @@
    Ident.Set.union(
      anf_free_vars_help(env, thn),
      anf_free_vars_help(env, els),
    )
  | CFor(cond, inc, body) =>
    let cond =
      Option.fold(
        ~none=Ident.Set.empty,
        ~some=anf_free_vars_help(env),
        cond,
      );
    let inc =
      Option.fold(~none=Ident.Set.empty, ~some=anf_free_vars_help(env), inc);
    let body = anf_free_vars_help(env, body);
    Ident.Set.union(cond, Ident.Set.union(inc, body));
  | CContinue
  | CBreak => Ident.Set.empty
  | CSwitch(arg, branches, _) =>
    List.fold_left(
      (acc, (_, b)) => Ident.Set.union(anf_free_vars_help(env, b), acc),
      imm_free_vars_help(env, arg),
      branches,
    )
  | CPrim0(_) => Ident.Set.empty
  | CPrim1(_, arg) => imm_free_vars_help(env, arg)
  | CPrim2(_, arg1, arg2) =>
    Ident.Set.union(
      imm_free_vars_help(env, arg1),
      imm_free_vars_help(env, arg2),
    )
  | CPrimN(_, args) =>
    List.fold_left(
      (acc, a) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      Ident.Set.empty,
      args,
    )
  | CBoxAssign(arg1, arg2) =>
    Ident.Set.union(
      imm_free_vars_help(env, arg1),
      imm_free_vars_help(env, arg2),
    )
  | CAssign(arg1, arg2) =>
    Ident.Set.union(
      imm_free_vars_help(env, arg1),
      imm_free_vars_help(env, arg2),
    )
  | CLocalAssign(arg1, arg2) => imm_free_vars_help(env, arg2)
  | CApp((fn, _), args, _) =>
    List.fold_left(
      (acc, a) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      imm_free_vars_help(env, fn),
      args,
    )
  | CAppBuiltin(_, _, args) =>
    List.fold_left(
      (acc, a) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      Ident.Set.empty,
      args,
    )
  | CTuple(args)
  | CArray(args)
  | CAdt(_, _, args) =>
    List.fold_left(
      (acc, a) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      Ident.Set.empty,
      args,
    )
  | CArrayGet(arg1, arg2) =>
    List.fold_left(
      (acc, a) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      Ident.Set.empty,
      [arg1, arg2],
    )
  | CArraySet(arg1, arg2, arg3) =>
    List.fold_left(
      (acc, a) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      Ident.Set.empty,
      [arg1, arg2, arg3],
    )
  | CRecord(_, args) =>
    List.fold_left(
      (acc, (_, a)) => Ident.Set.union(imm_free_vars_help(env, a), acc),
      Ident.Set.empty,
      args,
    )
  | CGetTupleItem(_, arg)
  | CGetAdtItem(_, arg)
  | CGetAdtTag(arg)
  | CGetRecordItem(_, arg) => imm_free_vars_help(env, arg)
  | CSetRecordItem(_, arg1, arg2)
  | CSetTupleItem(_, arg1, arg2) =>
    Ident.Set.union(
      imm_free_vars_help(env, arg1),
      imm_free_vars_help(env, arg2),
    )
  | CNumber(_)
  | CInt32(_)
  | CInt64(_)
  | CFloat32(_)
  | CFloat64(_)
  | CBytes(_)
  | CString(_)
  | CChar(_) => Ident.Set.empty
  | CImmExpr(i) => imm_free_vars_help(env, i)
  }

and imm_free_vars_help = (env, i: imm_expression) =>
  switch (i.imm_desc) {
  | ImmId(x) when !Ident.Set.mem(x, env) => Ident.Set.singleton(x)
  | _ => Ident.Set.empty
  };

let anf_free_vars = anf_free_vars_help(Ident.Set.empty);
let comp_free_vars = comp_free_vars_help(Ident.Set.empty);
let imm_free_vars = imm_free_vars_help(Ident.Set.empty);

type stack_size = {
  stack_size_ptr: int,
  stack_size_i32: int,
  stack_size_i64: int,
  stack_size_f32: int,
  stack_size_f64: int,
};

let stack_size_max = (a, b) => {
  stack_size_ptr: max(a.stack_size_ptr, b.stack_size_ptr),
  stack_size_i32: max(a.stack_size_i32, b.stack_size_i32),
  stack_size_i64: max(a.stack_size_i64, b.stack_size_i64),
  stack_size_f32: max(a.stack_size_f32, b.stack_size_f32),
  stack_size_f64: max(a.stack_size_f64, b.stack_size_f64),
};

let stack_size_add = (a, b) => {
  stack_size_ptr: a.stack_size_ptr + b.stack_size_ptr,
  stack_size_i32: a.stack_size_i32 + b.stack_size_i32,
  stack_size_i64: a.stack_size_i64 + b.stack_size_i64,
  stack_size_f32: a.stack_size_f32 + b.stack_size_f32,
  stack_size_f64: a.stack_size_f64 + b.stack_size_f64,
};

let initial_stack_size = {
  stack_size_ptr: 0,
  stack_size_i32: 0,
  stack_size_i64: 0,
  stack_size_f32: 0,
  stack_size_f64: 0,
};

let rec anf_count_vars = a =>
  switch (a.anf_desc) {
  | AELet(global, recflag, mutflag, binds, body) =>
    let max_binds =
      List.fold_left(stack_size_max, initial_stack_size) @@
      List.map(((_, c)) => comp_count_vars(c), binds);
    let rec count_binds = (ptr, i32, i64, f32, f64, binds) => {
      switch (global, binds) {
      | (Global, [_, ...rest]) => count_binds(ptr, i32, i64, f32, f64, rest)
      | (_, [(_, {comp_allocation_type: Managed}), ...rest]) =>
        count_binds(ptr + 1, i32, i64, f32, f64, rest)
      | (_, [(_, {comp_allocation_type: Unmanaged(WasmI32)}), ...rest]) =>
        count_binds(ptr, i32 + 1, i64, f32, f64, rest)
      | (_, [(_, {comp_allocation_type: Unmanaged(WasmI64)}), ...rest]) =>
        count_binds(ptr, i32, i64 + 1, f32, f64, rest)
      | (_, [(_, {comp_allocation_type: Unmanaged(WasmF32)}), ...rest]) =>
        count_binds(ptr, i32, i64, f32 + 1, f64, rest)
      | (_, [(_, {comp_allocation_type: Unmanaged(WasmF64)}), ...rest]) =>
        count_binds(ptr, i32, i64, f32, f64 + 1, rest)
      | (_, []) => {
          stack_size_ptr: ptr,
          stack_size_i32: i32,
          stack_size_i64: i64,
          stack_size_f32: f32,
          stack_size_f64: f64,
        }
      };
    };
    switch (recflag) {
    | Recursive =>
      stack_size_add(
        count_binds(0, 0, 0, 0, 0, binds),
        stack_size_max(max_binds, anf_count_vars(body)),
      )
    | Nonrecursive =>
      stack_size_max(
        max_binds,
        stack_size_add(
          count_binds(0, 0, 0, 0, 0, binds),
          anf_count_vars(body),
        ),
      )
    };
  | AESeq(hd, tl) =>
    stack_size_max(comp_count_vars(hd), anf_count_vars(tl))
  | AEComp(c) => comp_count_vars(c)
  }

and comp_count_vars = c =>
  switch (c.comp_desc) {
  | CIf(_, t, f) => stack_size_max(anf_count_vars(t), anf_count_vars(f))
  | CFor(c, inc, b) =>
    let c = Option.fold(~none=initial_stack_size, ~some=anf_count_vars, c);
    let inc =
      Option.fold(~none=initial_stack_size, ~some=anf_count_vars, inc);
    let b = anf_count_vars(b);
    stack_size_add(c, stack_size_add(inc, b));
  | CSwitch(_, bs, _) =>
    List.fold_left(stack_size_max, initial_stack_size) @@
    List.map(((_, b)) => anf_count_vars(b), bs)
  | _ => initial_stack_size
  };

module ClearLocationsArg: Anf_mapper.MapArgument = {
  include Anf_mapper.DefaultMapArgument;

  let leave_imm_expression = i => {...i, imm_loc: Location.dummy_loc};

  let leave_comp_expression = c => {...c, comp_loc: Location.dummy_loc};

  let leave_anf_expression = a => {...a, anf_loc: Location.dummy_loc};
};

module ClearLocations = Anf_mapper.MakeMap(ClearLocationsArg);

let clear_locations = ClearLocations.map_anf_program;
