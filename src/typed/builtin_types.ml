(* Modified version of predef.ml from OCaml. Original copyright notice is below. *)
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

(* Predefined type constructors (with special typing rules in typecore) *)

open Grain_parsing
open Path
open Types
open Btype

let builtin_idents = ref []

let wrap create s =
  let id = create s in
  builtin_idents := (s, id) :: !builtin_idents;
  id

let ident_create = wrap Ident.create
let ident_create_predef_exn = wrap Ident.create_predef_exn

let ident_number = ident_create "Number"
and ident_bool = ident_create "Bool"
and ident_string = ident_create "String"
and ident_void = ident_create "Void" (* TODO: When we have type aliases, make "Unit" an alias *)

let path_number = PIdent ident_number
and path_bool = PIdent ident_bool
and path_string = PIdent ident_string
and path_void = PIdent ident_void

let type_number = newgenty (TTyConstr(path_number, [], ref TMemNil))
and type_bool = newgenty (TTyConstr(path_bool, [], ref TMemNil))
and type_string = newgenty (TTyConstr(path_string, [], ref TMemNil))
and type_void = newgenty (TTyConstr(path_void, [], ref TMemNil))


let all_predef_exns = [
]

let decl_abstr =
  {type_params = [];
   type_arity = 0;
   type_kind = TDataAbstract;
   type_loc = Location.dummy_loc;
   type_manifest = None;
   type_newtype_level = None;
   type_immediate = false;
  }

let decl_abstr_imm = {decl_abstr with type_immediate = true}

let cstr id args = {
  cd_id = id;
  cd_args = TConstrTuple args;
  cd_res = None;
  cd_loc = Location.dummy_loc;
}

let ident_false = ident_create "false"
and ident_true = ident_create "true"
and ident_void = ident_create "()" (* TODO: Decide if we want different syntax *)
let common_initial_env add_type empty_env =
  let decl_bool =
    {decl_abstr with
     type_kind = TDataVariant([cstr ident_false []; cstr ident_true []]);
     type_immediate = true}
  and decl_void =
    {decl_abstr with
     type_kind = TDataVariant([cstr ident_void []]);
     type_immediate = true}
  in
  empty_env
  |> add_type ident_number decl_abstr_imm
  |> add_type ident_bool decl_bool
  |> add_type ident_string decl_abstr
  |> add_type ident_void decl_void

let build_initial_env add_type empty_env =
  let common = common_initial_env add_type empty_env in
  (*let safe_string = add_type ident_bytes decl_abstr common in
  let decl_bytes_unsafe = {decl_abstr with type_manifest = Some type_string} in
  let unsafe_string = add_type ident_bytes decl_bytes_unsafe common in
    (safe_string, unsafe_string)*)
  (common, common)

let builtin_values =
  List.map (fun id -> Ident.make_global id; (Ident.name id, id))
      []

(* Start non-predef identifiers at 1000.  This way, more predefs can
   be defined in this file (above!) without breaking .cmi
   compatibility. *)

let _ = Ident.set_current_time 999
let builtin_idents = List.rev !builtin_idents
