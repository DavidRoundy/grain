(* This file is mostly copied from OCaml's parsing/ast_helper.ml.
   The original copyright notice is reproduced below. *)
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

open Parsetree

type id = Identifier.t loc
type str = string loc
type loc = Location.t

let default_loc_src = ref (fun () -> Location.dummy_loc)

let with_default_loc_src ls f =
  let old = !default_loc_src in
  default_loc_src := ls;
  try let r = f () in default_loc_src := old; r
  with exn -> default_loc_src := old; raise exn

let with_default_loc l =
  with_default_loc_src (fun() -> l)

module Const = struct
  let string s = PConstString s
  let int i = PConstNumber i
  let bool b = PConstBool b
end

module Typ = struct
  let mk ?loc d =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {ptyp_desc=d; ptyp_loc=loc}
  let any ?loc () = mk ?loc PTyAny
  let var ?loc a = mk ?loc (PTyVar a)
  let arrow ?loc a b = mk ?loc (PTyArrow(a, b))
  let tuple ?loc a = mk ?loc (PTyTuple a)
  let constr ?loc a b = mk ?loc (PTyConstr(a, b))
  let poly ?loc a b = mk ?loc (PTyPoly(a, b))
end

module CDecl = struct
  let mk ?loc n a =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {pcd_name=n; pcd_args=a; pcd_loc=loc}
  let singleton ?loc n = mk ?loc n PConstrSingleton
  let tuple ?loc n a = mk ?loc n (PConstrTuple a)
end

module Dat = struct
  let mk ?loc n t k =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {pdata_name=n; pdata_params=t; pdata_kind=k; pdata_loc=loc}
  let variant ?loc n t cdl = mk ?loc n t (PDataVariant cdl)
end

module Pat = struct
  let mk ?loc d =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {ppat_desc=d; ppat_loc=loc}
  let any ?loc () = mk ?loc PPatAny
  let var ?loc a = mk ?loc (PPatVar a)
  let tuple ?loc a = mk ?loc (PPatTuple a)
  let constant ?loc a = mk ?loc (PPatConstant a)
  let constraint_ ?loc a b = mk ?loc (PPatConstraint(a, b))
  let construct ?loc a b = mk ?loc (PPatConstruct(a, b))
  let or_ ?loc a b = mk ?loc (PPatOr(a, b))
  let alias ?loc a b = mk ?loc (PPatAlias(a, b))
end

module Exp = struct
  let mk ?loc d =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {pexp_desc=d; pexp_loc=loc}
  let ident ?loc a = mk ?loc (PExpId a)
  let constant ?loc a = mk ?loc (PExpConstant a)
  let tuple ?loc a = mk ?loc (PExpTuple a)
  let let_ ?loc a b c = mk ?loc (PExpLet(a, b, c))
  let match_ ?loc a b = mk ?loc (PExpMatch(a, b))
  let prim1 ?loc a b = mk ?loc (PExpPrim1(a, b))
  let prim2 ?loc a b c = mk ?loc (PExpPrim2(a, b, c))
  let if_ ?loc a b c = mk ?loc (PExpIf(a, b, c))
  let while_ ?loc a b = mk ?loc (PExpWhile(a, b))
  let assign ?loc a b = mk ?loc (PExpAssign(a, b))
  let lambda ?loc a b = mk ?loc (PExpLambda(a, b))
  let apply ?loc a b = mk ?loc (PExpApp(a, b))
  let block ?loc a = mk ?loc (PExpBlock a)
  let null ?loc () = mk ?loc PExpNull
end

module Top = struct
  let mk ?loc d =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {ptop_desc=d; ptop_loc=loc}
  let import ?loc i = mk ?loc (PTopImport i)
  let foreign ?loc e d = mk ?loc (PTopForeign (e, d))
  let data ?loc e d = mk ?loc (PTopData (e, d))
  let let_ ?loc e r vb = mk ?loc (PTopLet(e, r, vb))
  let export ?loc e = mk ?loc (PTopExport e)
  let export_data ?loc e = mk ?loc (PTopExportData e)
end

module Val = struct
  let mk ?loc ~mod_ ~name ~typ ~prim =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {
      pval_mod=mod_;
      pval_name=name;
      pval_type=typ;
      pval_prim=prim;
      pval_loc=loc;
    }
end

module Vb = struct
  let mk ?loc p e =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {pvb_pat=p; pvb_expr=e; pvb_loc=loc}
end

module Mb = struct
  let mk ?loc p e =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {pmb_pat=p; pmb_body=e; pmb_loc=loc}
end

module Imp = struct
  let mk ?loc m =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    {pimp_mod=m; pimp_loc=loc}
end

module Ex = struct
  let mk ?loc exports =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    List.map (fun (name, alias) -> 
      {pex_name=name; pex_alias=alias; pex_loc=loc}
    ) exports
end

module ExD = struct
  let mk ?loc exports =
    let loc = match loc with
      | None -> (!default_loc_src)()
      | Some l -> l in
    List.map (fun name -> 
      {pexd_name=name; pexd_loc=loc}
    ) exports
end

