(**************************************************************************)
(*                                                                        *)
(*                                 OCaml                                  *)
(*                                                                        *)
(*             Xavier Leroy, projet Cristal, INRIA Rocquencourt           *)
(*                                                                        *)
(*   Copyright 1996 Institut National de Recherche en Informatique et     *)
(*     en Automatique.                                                    *)
(*                                                                        *)
(*   All rights reserved.  This file is distributed under the terms of    *)
(*   the GNU Lesser General Public License version 2.1, with the          *)
(*   special exception on linking described in the file LICENSE.          *)
(*                                                                        *)
(**************************************************************************)

open Grain_parsing
open Misc
open Longident
open Path
open Asttypes
open Parsetree
open Types
open Format

type error =
    Cannot_apply of module_type
  | Not_included of Includemod.error list
  | Cannot_eliminate_dependency of module_type
  | Signature_expected
  | Structure_expected of module_type
  | With_no_component of Identifier.t
  | With_mismatch of Identifier.t * Includemod.error list
  | With_makes_applicative_functor_ill_typed of
      Identifier.t * Path.t * Includemod.error list
  | With_changes_module_alias of Identifier.t * Ident.t * Path.t
  | With_cannot_remove_constrained_type
  | Repeated_name of string * string
  | Non_generalizable of type_expr
  | Non_generalizable_module of module_type
  | Implementation_is_required of string
  | Interface_not_compiled of string
  | Not_allowed_in_functor_body
  | Not_a_packed_module of type_expr
  | Incomplete_packed_module of type_expr
  | Scoping_pack of Identifier.t * type_expr
  | Recursive_module_require_explicit_type
  | Apply_generative
  | Cannot_scrape_alias of Path.t

exception Error of Location.t * Env.t * error
exception Error_forward of Location.error

open Typedtree


let extract_sig env loc mty =
  match Env.scrape_alias env mty with
  | TModSignature sg -> sg
  (*| Mty_alias(_, path) ->
      raise(Error(loc, env, Cannot_scrape_alias path))*)
  | _ -> raise(Error(loc, env, Signature_expected))

let extract_sig_open env loc mty =
  match Env.scrape_alias env mty with
  | TModSignature sg -> sg
  (*| Mty_alias(_, path) ->
      raise(Error(loc, env, Cannot_scrape_alias path))*)
  | mty -> raise(Error(loc, env, Structure_expected mty))

(* Compute the environment after opening a module *)

let type_open_ ?used_slot ?toplevel (*ovf*) env loc lid =
  let path = Typetexp.lookup_module ~load:true env lid.loc lid.txt in
  match Env.open_signature ~loc ?used_slot ?toplevel (*ovf*) path env with
  | Some env -> path, env
  | None ->
      let md = Env.find_module path env in
      ignore (extract_sig_open env lid.loc md.md_type);
      assert false

let type_initially_opened_module env module_name =
  let loc = Location.in_file "compiler internals" in
  let lid = { Asttypes.loc; txt = Identifier.IdentName module_name } in
  let path = Typetexp.lookup_module ~load:true env lid.loc lid.txt in
  match Env.open_signature_of_initially_opened_module path env with
  | Some env -> path, env
  | None ->
      let md = Env.find_module path env in
      ignore (extract_sig_open env lid.loc md.md_type);
      assert false

let initial_env ~loc ~initially_opened_module ~open_implicit_modules =
  let env = Env.initial_safe_string in
  let env = match initially_opened_module with
    | None -> env
    | Some name -> snd (type_initially_opened_module env name)
  in
  let open_implicit_module env m =
    let open Asttypes in
    let lid = {loc; txt = Identifier.parse m } in
    snd (type_open_ env lid.loc lid)
  in
  List.fold_left open_implicit_module env open_implicit_modules

let type_open ?toplevel env sod =
  let (path, newenv) =
    (*Builtin_attributes.warning_scope sod.popen_attributes
      (fun () ->*)
         type_open_ ?toplevel env sod.pimp_loc
           sod.pimp_mod
      (* )*)
  in
  let od =
    {
      (*open_override = sod.popen_override;*)
      timp_path = path;
      timp_mod = sod.pimp_mod;
      (*open_attributes = sod.popen_attributes;*)
      timp_loc = sod.pimp_loc;
    }
  in
  (path, newenv, od)

(* Simplify multiple specifications of a value or an extension in a signature.
   (Other signature components, e.g. types, modules, etc, are checked for
   name uniqueness.)  If multiple specifications with the same name,
   keep only the last (rightmost) one. *)

let simplify_signature sg =
  let rec aux = function
    | [] -> [], StringSet.empty
    | (TSigValue(id, _descr) as component) :: sg ->
        let (sg, val_names) as k = aux sg in
        let name = Ident.name id in
        if StringSet.mem name val_names then k
        else (component :: sg, StringSet.add name val_names)
    | component :: sg ->
        let (sg, val_names) = aux sg in
        (component :: sg, val_names)
  in
  let (sg, _) = aux sg in
  sg

(* Add recursion flags on declarations arising from a mutually recursive
   block. *)

let map_rec fn decls rem =
  match decls with
  | [] -> rem
  | d1 :: dl -> fn TRecFirst d1 :: map_end (fn TRecNext) dl rem

let map_rec_type ~rec_flag fn decls rem =
  match decls with
  | [] -> rem
  | d1 :: dl ->
      let first =
        match rec_flag with
        | Recursive -> TRecFirst
        | Nonrecursive -> TRecNot
      in
      fn first d1 :: map_end (fn TRecNext) dl rem

let rec map_rec_type_with_row_types ~rec_flag fn decls rem =
  match decls with
  | [] -> rem
  | d1 :: dl ->
      (*if Btype.is_row_name (Ident.name d1.typ_id) then
        fn Trec_not d1 :: map_rec_type_with_row_types ~rec_flag fn dl rem
      else*)
        map_rec_type ~rec_flag fn decls rem



(* Auxiliaries for checking uniqueness of names in signatures and structures *)

module StringSet =
  Set.Make(struct type t = string let compare (x:t) y = String.compare x y end)

let check cl loc set_ref name =
  if StringSet.mem name !set_ref
  then raise(Error(loc, Env.empty, Repeated_name(cl, name)))
  else set_ref := StringSet.add name !set_ref

type names =
  {
    types: StringSet.t ref;
    modules: StringSet.t ref;
    modtypes: StringSet.t ref;
    typexts: StringSet.t ref;
  }

let new_names () =
  {
    types = ref StringSet.empty;
    modules = ref StringSet.empty;
    modtypes = ref StringSet.empty;
    typexts = ref StringSet.empty;
  }


let check_name check names name = check names name.loc name.txt
let check_type names loc s = check "type" loc names.types s
let check_module names loc s = check "module" loc names.modules s
let check_modtype names loc s = check "module type" loc names.modtypes s


let check_sig_item names loc = function
  | TSigType(id, _, _) -> check_type names loc (Ident.name id)
  | TSigModule(id, _, _) -> check_module names loc (Ident.name id)
  | TSigModType(id, _) -> check_modtype names loc (Ident.name id)
  | _ -> ()


(* Check that all core type schemes in a structure are closed *)

let rec closed_modtype env = function
  | TModIdent _ -> true
  (*| Mty_alias _ -> true*)
  | TModSignature sg ->
      let env = Env.add_signature sg env in
      List.for_all (closed_signature_item env) sg
  (*| Mty_functor(id, param, body) ->
      let env = Env.add_module ~arg:true id (Btype.default_mty param) env in
      closed_modtype env body*)

and closed_signature_item env = function
  | TSigValue(_id, desc) -> Ctype.closed_schema env desc.val_type
  | TSigModule(_id, md, _) -> closed_modtype env md.md_type
  | _ -> true

let check_nongen_scheme env sig_item =
  match sig_item with
  | TSigValue(_id, vd) ->
    if not (Ctype.closed_schema env vd.val_type) then
      raise (Error (vd.val_loc, env, Non_generalizable vd.val_type))
  | TSigModule(_id, md, _) ->
    if not (closed_modtype env md.md_type) then
      raise(Error(md.md_loc, env, Non_generalizable_module md.md_type))
  | _ -> ()

let check_nongen_schemes env sg =
  List.iter (check_nongen_scheme env) sg


(* Normalize types in a signature *)

let rec normalize_modtype env = function
  | TModIdent _
  (*| Mty_alias _*) -> ()
  | TModSignature sg -> normalize_signature env sg
  (*| Mty_functor(_id, _param, body) -> normalize_modtype env body*)

and normalize_signature env = List.iter (normalize_signature_item env)

and normalize_signature_item env = function
  | TSigValue(_id, desc) -> Ctype.normalize_type env desc.val_type
  | TSigModule(_id, md, _) -> normalize_modtype env md.md_type
  | _ -> ()


let enrich_type_decls anchor decls oldenv newenv =
  match anchor with
    None -> newenv
  | Some p ->
      List.fold_left
        (fun e info ->
          let id = info.data_id in
          let info' =
            let p = PExternal(p, Ident.name id, nopos) in
            let decl = info.data_type in
            match decl.type_manifest with
            | Some _ -> decl
            | None ->
              try
                let orig_decl = Env.find_type p oldenv in
                if orig_decl.type_arity <> decl.type_arity
                then decl
                else {decl with type_manifest = Some(Btype.newgenty(TTyConstr(p, decl.type_params, ref TMemNil)))}
              with Not_found -> decl
          in
            Env.add_type ~check:true id info' e)
        oldenv decls


let type_module ?(toplevel=false) funct_body anchor env sstr (*scope*) =

  let export_all = ref (false, []) in
  let export_data_all = ref (false, []) in
  List.iter (fun {ptop_desc} ->
    (* Take the last export *; after well-formedness there should only be one *)
    match ptop_desc with
    | PTopExportAll excepts -> export_all := true, excepts
    | PTopExportDataAll excepts -> export_data_all := true, excepts
    | _ -> ()
  ) sstr.Parsetree.statements;

  let string_needs_export (str : string Grain_parsing.Parsetree.loc) =
    let flag, excepts = !export_all in
    flag && not @@ List.exists (fun {txt} -> Identifier.string_of_ident txt = str.txt) excepts in

  let ident_needs_export (id : Ident.t) =
    let flag, excepts = !export_all in
    flag && not @@ List.exists (fun except_id -> id.name = Identifier.string_of_ident except_id.txt) excepts in

  let data_needs_export (str : string Grain_parsing.Parsetree.loc) =
    let flag, excepts = !export_data_all in
    flag && not @@ List.exists (fun {txt} -> txt = str.txt) excepts in

  let process_foreign env e d loc =
    let (desc, newenv) = Typedecl.transl_value_decl env loc d in
    let e = if string_needs_export d.pval_name then Exported else e in
    let signature = match e with
      | Exported -> Some(TSigValue(desc.tvd_id, desc.tvd_val))
      | Nonexported -> None in
    let foreign = {ttop_desc=TTopForeign desc; ttop_loc=loc; ttop_env=env} in
    newenv, signature, foreign in

  let process_import env i loc =
    let _path, newenv, od = type_open env i in
    newenv, {ttop_desc=TTopImport(od); ttop_loc=loc; ttop_env=env} in

  let process_datas env e datas loc =
    let decls, newenv = Typedecl.transl_data_decl env Recursive datas in
    let ty_decl = map_rec_type_with_row_types ~rec_flag:Recursive
        (fun rs info -> 
          let e = if data_needs_export info.data_name then Exported else e in
          match e with
          | Exported -> TSigType(info.data_id, info.data_type, rs)
          | Nonexported -> TSigType(info.data_id, {info.data_type with type_kind=TDataAbstract}, rs)
        ) decls [] in
    let statement = {ttop_desc=TTopData(decls); ttop_loc=loc; ttop_env=newenv} in
    let newenv = enrich_type_decls anchor decls env newenv in
    newenv, ty_decl, statement in

  let process_let env export_flag rec_flag binds loc =
    Ctype.init_def(Ident.current_time());
    let scope = None in
    let defs, newenv = Typecore.type_binding env rec_flag binds scope in
    let () = if rec_flag = Recursive then
        Typecore.check_recursive_bindings env defs
    in
    let some_exported = ref false in
    let signatures = List.fold_right (fun id sigs ->
      if ident_needs_export id || export_flag = Exported
      then (some_exported := true; (TSigValue(id, Env.find_value (PIdent id) newenv))::sigs)
      else sigs
    ) (let_bound_idents defs) [] in
    let export_flag = if !some_exported then Exported else export_flag in
    let stmt = { ttop_desc = TTopLet(export_flag, rec_flag, defs); ttop_loc = loc; ttop_env = env } in
    newenv, signatures, stmt in

  let process_export env exports loc =
    let bindings = List.map (fun {pex_name=name; pex_alias=alias; pex_loc=loc} ->
      let exported_name = match alias with 
      | Some(alias) -> alias.txt 
      | None -> Identifier.string_of_ident name.txt in
      let bind_name = { txt=exported_name; loc } in
      {
        pvb_pat={ppat_desc=PPatVar(bind_name); ppat_loc=loc};
        pvb_expr={pexp_loc=loc; pexp_desc=PExpId name};
        pvb_loc=loc;
      }
    ) exports in
    process_let env Exported Nonrecursive bindings loc in

  let process_export_data env exports loc =
    let process_one rs {pexd_name=name; pexd_loc=loc} =
      let type_id = Env.lookup_type (IdentName name.txt) env in
      let type_ = Env.find_type type_id env in
      TSigType(Path.head type_id, type_, rs) in
    if List.length exports > 1 then
      (process_one TRecFirst (List.hd exports))::List.map (process_one TRecNext) (List.tl exports)
    else
      List.map (process_one TRecNot) exports in

  let final_env, signatures, statements = List.fold_left (fun (env, signatures, statements) {ptop_desc; ptop_loc=loc} ->
      match ptop_desc with
      | PTopImport i -> 
        let new_env, statement = process_import env i loc in 
        new_env, signatures, statement::statements
      | PTopExport ex -> 
        let new_env, sigs, statement = process_export env ex loc in 
        new_env, List.rev sigs @ signatures, statement::statements
      | PTopExportData ex -> 
        let sigs = process_export_data env ex loc in 
        env, List.rev sigs @ signatures, statements
      | PTopForeign(e, d) -> 
        let new_env, signature, statement = process_foreign env e d loc in
        let signatures = match signature with Some(s) -> s::signatures | None -> signatures in
        new_env, signatures, statement::statements
      | PTopData(e, d) -> 
        let new_env, sigs, statement = process_datas env e [d] loc in 
        new_env, List.rev sigs @ signatures, statement::statements
      | PTopLet(e, r, vb) -> 
        let new_env, sigs, statement = process_let env e r vb loc in 
        new_env, List.rev sigs @ signatures, statement::statements
      | PTopExportAll _
      | PTopExportDataAll _ -> env, signatures, statements
  ) (env, [], []) sstr.Parsetree.statements in
  let signatures, statements = List.rev signatures, List.rev statements in

  (* let (foreigns, imports, exports, datas, lets) = List.fold_right (fun {ptop_desc; ptop_loc=loc} (foreigns, imports, exports, datas, lets) ->
      match ptop_desc with
      | PTopImport i -> (foreigns, (i, loc)::imports, exports, datas, lets)
      | PTopExport ex -> (foreigns, imports, (ex, loc)::exports, datas, lets)
      | PTopForeign(e, d) -> ((e, d, loc)::foreigns, imports, exports, datas, lets)
      | PTopData(e, d) -> (foreigns, imports, exports, (e, d, loc)::datas, lets)
      | PTopLet(e, r, vb) -> (foreigns, imports, exports, datas, ((e, r, vb), loc)::lets)) sstr.Parsetree.statements ([], [], [], [], []) in *)

  (* TODO: imports*)

  (* let env, foreign_sigs, foreigns = List.fold_left (fun (env, foreign_sigs, foreigns) (e, d, loc) ->
      let (desc, newenv) = Typedecl.transl_value_decl env loc d in
      let foreign_sigs = match e with
        | Exported -> TSigValue(desc.tvd_id, desc.tvd_val)::foreign_sigs
        | Nonexported -> foreign_sigs in
      let f = {ttop_desc=TTopForeign desc; ttop_loc=loc; ttop_env=env} in
      newenv, foreign_sigs, (f::foreigns)
    ) (env, [], []) foreigns in
  let env, imports = List.fold_left (fun (env, imports) (i, loc) ->
      let _path, newenv, od = type_open env i in
      newenv, ({ttop_desc=TTopImport(od); ttop_loc=loc; ttop_env=env}::imports)) (env, []) imports in
  let imports = List.rev imports in *)

  (* let data_exports, datas = List.split @@ List.map (fun (e, d, loc) -> e, (d, loc)) datas in
  let decls, newenv = Typedecl.transl_data_decl env Recursive (List.map fst datas) in
  let export_decl_pairs = List.combine data_exports decls in
  let ty_decl = List.concat @@ map_rec_type_with_row_types ~rec_flag:Recursive
      (fun rs (e, info) -> match e with
        | Exported -> [TSigType(info.data_id, info.data_type, rs)]
        | Nonexported -> []
      ) export_decl_pairs [] in
  let newenv = enrich_type_decls anchor decls env newenv in *)

  (* let process_let env (export_flag, rec_flag, binds) =
    let scope = None in
    let defs, newenv = Typecore.type_binding env rec_flag binds scope in
    let () = if rec_flag = Recursive then
        Typecore.check_recursive_bindings env defs
    in
    let signatures = match export_flag with
      | Exported -> 
        List.map (fun id -> TSigValue(id, Env.find_value (PIdent id) newenv))
        (let_bound_idents defs)
      | Nonexported -> [] in
    (TTopLet(export_flag, rec_flag, defs)), signatures, newenv in *)

  (* let init_stmts = List.map2 (fun d (_, loc) -> {ttop_desc=TTopData(d); ttop_loc=loc; ttop_env=newenv}) decls datas in *)

  (* let rec process_all_lets env lets =
    Ctype.init_def(Ident.current_time());
    match lets with
    | [] -> ([], [], env)
    | (lt, loc) :: rem ->
      let desc, sg, new_env = process_let env lt in
      let stmt = { ttop_desc = desc; ttop_loc = loc; ttop_env = env } in
      let (tt_rem, sig_rem, final_env) = process_all_lets new_env rem in
      (stmt::tt_rem, sg @ sig_rem, final_env) in *)

  let run() =
    (* let (items, sg, final_env) = process_all_lets newenv lets in *)
    (* TODO: Is it really safe to drop the import statements here? *)
    (* ignore(imports); *)
    (* let stritems = ((imports @ foreigns @ init_stmts @ items), final_env, Typecore.type_expression final_env sstr.body) in
    stritems, (ty_decl @ sg @ foreign_sigs), final_env in *)
    let stritems = (statements, final_env, Typecore.type_expression final_env sstr.body) in
    stritems, signatures, final_env in

  run()

let type_module = type_module false None

let implicit_modules : string list ref = ref ["pervasives"]

let open_implicit_module m env =
  let open Asttypes in
  let loc = Location.dummy_loc in
  let lid = {loc; txt = Identifier.parse m} in
  (*ignore (Env.find_module (PIdent(Ident.create_persistent m)) env);*)
  let _path, newenv = type_open_ env lid.loc lid in
  newenv

let initial_env () =
  Ident.reinit();
  let initial = Env.initial_safe_string in
  let env = initial in
  List.fold_left (fun env m ->
      if Env.get_unit_name() <> m then
        open_implicit_module m env
      else env) env (!implicit_modules)

let type_implementation prog =
  let sourcefile = prog.prog_loc.loc_start.pos_fname in
  (* TODO: Do we maybe need a fallback here? *)
  let modulename = Grain_utils.Files.filename_to_module_name sourcefile in
  Env.set_unit_name modulename;
  let initenv = initial_env() in
  let (stritems, sg, finalenv) = type_module initenv prog in
  let (statements, env, body) = stritems in
  let simple_sg = simplify_signature sg in
  let filename = sourcefile in (* TODO: I think this is okay *)
  let coercion = Includemod.compunit initenv ~mark:Includemod.Mark_positive
      sourcefile sg "(inferred signature)" simple_sg
  in
  check_nongen_schemes finalenv simple_sg;
  normalize_signature finalenv simple_sg;
  let signature = Env.build_signature simple_sg modulename filename in
  ignore(coercion);
  {
    statements;
    env;
    body;
    signature;
  }

(* Error report *)

open Printtyp

let report_error ppf = function
    Cannot_apply mty ->
      fprintf ppf
        "@[This module is not a functor; it has type@ %a@]" modtype mty
  | Not_included errs ->
      fprintf ppf
        "@[<v>Signature mismatch:@ %a@]" Includemod.report_error errs
  | Cannot_eliminate_dependency mty ->
      fprintf ppf
        "@[This functor has type@ %a@ \
           The parameter cannot be eliminated in the result type.@  \
           Please bind the argument to a module identifier.@]" modtype mty
  | Signature_expected -> fprintf ppf "This module type is not a signature"
  | Structure_expected mty ->
      fprintf ppf
        "@[This module is not a structure; it has type@ %a" modtype mty
  | With_no_component lid ->
      fprintf ppf
        "@[The signature constrained by `with' has no component named %a@]"
        identifier lid
  | With_mismatch(lid, explanation) ->
      fprintf ppf
        "@[<v>\
           @[In this `with' constraint, the new definition of %a@ \
             does not match its original definition@ \
             in the constrained signature:@]@ \
           %a@]"
        identifier lid Includemod.report_error explanation
  | With_makes_applicative_functor_ill_typed(lid, path, explanation) ->
      fprintf ppf
        "@[<v>\
           @[This `with' constraint on %a makes the applicative functor @ \
             type %s ill-typed in the constrained signature:@]@ \
           %a@]"
        identifier lid (Path.name path) Includemod.report_error explanation
  | With_changes_module_alias(lid, id, path) ->
      fprintf ppf
        "@[<v>\
           @[This `with' constraint on %a changes %s, which is aliased @ \
             in the constrained signature (as %s)@].@]"
        identifier lid (Path.name path) (Ident.name id)
  | With_cannot_remove_constrained_type ->
      fprintf ppf
        "@[<v>Destructive substitutions are not supported for constrained @ \
              types (other than when replacing a type constructor with @ \
              a type constructor with the same arguments).@]"
  | Repeated_name(kind, name) ->
      fprintf ppf
        "@[Multiple definition of the %s name %s.@ \
           Names must be unique in a given structure or signature.@]" kind name
  | Non_generalizable typ ->
      fprintf ppf
        "@[The type of this expression,@ %a,@ \
           contains type variables that cannot be generalized@]" type_scheme typ
  | Non_generalizable_module mty ->
      fprintf ppf
        "@[The type of this module,@ %a,@ \
           contains type variables that cannot be generalized@]" modtype mty
  | Implementation_is_required intf_name ->
      fprintf ppf
        "@[The interface %a@ declares values, not just types.@ \
           An implementation must be provided.@]"
        Location.print_filename intf_name
  | Interface_not_compiled intf_name ->
      fprintf ppf
        "@[Could not find the .cmi file for interface@ %a.@]"
        Location.print_filename intf_name
  | Not_allowed_in_functor_body ->
      fprintf ppf
        "@[This expression creates fresh types.@ %s@]"
        "It is not allowed inside applicative functors."
  | Not_a_packed_module ty ->
      fprintf ppf
        "This expression is not a packed module. It has type@ %a"
        type_expr ty
  | Incomplete_packed_module ty ->
      fprintf ppf
        "The type of this packed module contains variables:@ %a"
        type_expr ty
  | Scoping_pack (lid, ty) ->
      fprintf ppf
        "The type %a in this module cannot be exported.@ " identifier lid;
      fprintf ppf
        "Its type contains local dependencies:@ %a" type_expr ty
  | Recursive_module_require_explicit_type ->
      fprintf ppf "Recursive modules require an explicit module type."
  | Apply_generative ->
      fprintf ppf "This is a generative functor. It can only be applied to ()"
  | Cannot_scrape_alias p ->
      fprintf ppf
        "This is an alias for module %a, which is missing"
        path p

let report_error env ppf err =
  Printtyp.wrap_printing_env ~error:true env (fun () -> report_error ppf err)

let () =
  Location.register_error_of_exn
    (function
      | Error (loc, env, err) ->
        Some (Location.error_of_printer loc (report_error env) err)
      | Error_forward err ->
        Some err
      | _ ->
        None
    )
