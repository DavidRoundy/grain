{
  open Lexing
  open Parser
  open Printf

  let lexbuf_loc {lex_start_p=loc_start; lex_curr_p=loc_end; _} =
    let open Location in
    {
      loc_start; loc_end; loc_ghost=false
    }

  type error =
    | UnrecognizedCharacter of char
    | UnicodeCharacter
    | IllegalStringCharacter of string

  exception Error of Location.t * error

  let report_error ppf err =
    match err with
    | UnrecognizedCharacter c ->
      Format.fprintf ppf "Unrecognized character: %C" c
    | UnicodeCharacter ->
      Format.fprintf ppf "Unicode characters are currently unsupported."
    | IllegalStringCharacter sc ->
      Format.fprintf ppf "Illegal string character: %S" sc

  let () =
    Location.register_error_of_exn
      (function
        | Error(loc, err) -> Some(Location.error_of_printer loc report_error err)
        | _ -> None)

  let add_char_code buf lexbuf = begin
    let str = lexeme lexbuf in
    let (esc, numstr) = ((String.sub str 1 1), (String.sub str 2 ((String.length str) - 2))) in
    let to_add = (match esc with
      | "u" -> Scanf.sscanf numstr "%x" (fun x -> x)
      | "x" -> Scanf.sscanf numstr "%x" (fun x -> x)
      | _ -> Scanf.sscanf (esc^numstr) "%o" (fun x -> x)) in
    if (to_add > 255) then
      raise (Error(lexbuf_loc lexbuf, UnicodeCharacter))
    else
      Buffer.add_char buf (Char.chr to_add);
  end

  let newline_regex = Str.regexp "\\(\r\\|\n\\)"

  let process_newlines lexbuf =
    let input = lexeme lexbuf in
    String.iter (fun c ->
      if Str.string_match newline_regex (String.make 1 c) 0
      then new_line lexbuf
    ) input

}

let dec_digit = ['0'-'9']
let hex_digit = ['0'-'9' 'A'-'F' 'a'-'f']
let oct_digit = ['0'-'7']
let bin_digit = ['0'-'1']

let dec_int = dec_digit (dec_digit | '_')*
let hex_int = "0x" hex_digit (hex_digit | '_')*
let oct_int = "0o" oct_digit (oct_digit | '_')*
let bin_int = "0b" bin_digit (bin_digit | '_')*

let signed_dec_int = dec_int | ('-' dec_int)
let signed_hex_int = hex_int | ('-' hex_int)
let signed_oct_int = oct_int | ('-' oct_int)
let signed_bin_int = bin_int | ('-' bin_int)

let signed_int = signed_dec_int | signed_hex_int | signed_oct_int | signed_bin_int

let ident = ['a'-'z' '_']['a'-'z' 'A'-'Z' '0'-'9' '_']*
let ident_cap = ['A'-'Z']['a'-'z' 'A'-'Z' '0'-'9' '_']*

let blank = [' ' '\t']+

let std_escapes = (("\\" dec_digit dec_digit? dec_digit?)
                 | ("\\x" hex_digit hex_digit?)
                 | ("\\u" hex_digit hex_digit? hex_digit? hex_digit?)
                 | ("\\" ['\\' 'n' 'r' 't' '"' '\''] ))

let tquot_str = "```" (std_escapes
                    | "\\`"
                    | "`"[^ '`']
                    | "``"[^ '`']
                    | [^ '`' '\\'])* "```"

let dquot_str = '"' (std_escapes
                   | [^ '\\' '"' '\n' '\r'])* '"'

let squot_str = '\'' (std_escapes
              | [^ '\\' '\'' '\n' '\r'])* '\''

let unicode_esc = "\\u" hex_digit (hex_digit (hex_digit hex_digit?)?)?
let hex_esc = "\\x" hex_digit hex_digit?
let oct_esc = "\\" oct_digit (oct_digit oct_digit?)?
let num_esc = (unicode_esc | hex_esc | oct_esc)

let newline_char = ("\r\n"|"\n\r"|'\n'|'\r')
let newline_chars = (newline_char | blank)* newline_char

let comment = '#' ((([^'|'])[^ '\r' '\n']*(newline_chars | eof)) | (newline_chars | eof))

rule token = parse
  | comment { process_newlines lexbuf; token lexbuf }
  | blank { token lexbuf }
  | newline_chars { process_newlines lexbuf; EOL }
  | (signed_int as x) 'l' { INT32 (Int32.of_string x) }
  | (signed_int as x) 'L' { INT64 (Int64.of_string x) }
  | signed_int as x { NUM (int_of_string x) }
  | "primitive" { PRIMITIVE }
  | "foreign" { FOREIGN }
  | "wasm" { WASM }
  | "while" { WHILE }
  | "if" { IF }
  | "else" { ELSE }
  | "true" { TRUE }
  | "false" { FALSE }
  | "import" { IMPORT }
  | "export" { EXPORT }
  | "except" { EXCEPT }
  | "from" { FROM }
  | "->" { ARROW }
  | "=>" { THICKARROW }
  | "data" { DATA }
  | "|" { PIPE }
  | "let" { LET }
  | "rec" { REC }
  | "match" { MATCH }
  | "assert" { ASSERT }
  | "fail" { FAIL }
  | "..." { ELLIPSIS }
  | "." { DOT }
  | "::" { COLONCOLON }
  | ":=" { GETS }
  | ":" { COLON }
  | "is" { IS }
  | "==" { EQEQ }
  | "=" { EQUAL }
  | "," { COMMA }
  | ";" { SEMI }
  | "as" { AS }
  | "(" { LPAREN }
  | ")" { RPAREN }
  | "{" { LBRACE }
  | "}" { RBRACE }
  | "[" { LBRACK }
  | "]" { RBRACK }
  | "<" { LCARET }
  | ">" { RCARET }
  | "^" { CARET }
  | "+" { PLUS }
  | "-" { DASH }
  | "*" { STAR }
  | "/" { SLASH }
  | "%" { PERCENT }
  | "<=" { LESSEQ }
  | ">=" { GREATEREQ }
  | "&&" { AMPAMP }
  | "||" { PIPEPIPE }
  | "!" { NOT }
  | '"'   { read_dquote_str (Buffer.create 16) lexbuf }
  | '\'' { read_squote_str (Buffer.create 16) lexbuf }
  | "_" { UNDERSCORE }
  | ident as x { ID x }
  | ident_cap as x { TYPEID x }
  | eof { EOF }
  | _ as c { raise (Error(lexbuf_loc lexbuf, UnrecognizedCharacter c)) }

and read_dquote_str buf =
  parse
  | '\\' newline_char { read_dquote_str buf lexbuf }
  | "\\n" { Buffer.add_char buf '\n'; read_dquote_str buf lexbuf }
  | "\\r" { Buffer.add_char buf '\r'; read_dquote_str buf lexbuf }
  | "\\\"" { Buffer.add_char buf '"'; read_dquote_str buf lexbuf }
  | "\\\\" { Buffer.add_char buf '\\'; read_dquote_str buf lexbuf }
  | num_esc { add_char_code buf lexbuf; read_dquote_str buf lexbuf }
  | [^ '"' '\\']+ { Buffer.add_string buf (lexeme lexbuf);
    read_dquote_str buf lexbuf }
  | '"' { STRING (Buffer.contents buf) }
  | _ { raise (Error(lexbuf_loc lexbuf, IllegalStringCharacter(lexeme lexbuf))) }

and read_squote_str buf =
  parse
  | "\\" newline_char { read_squote_str buf lexbuf }
  | "\\n" { Buffer.add_char buf '\n'; read_squote_str buf lexbuf }
  | "\\r" { Buffer.add_char buf '\r'; read_squote_str buf lexbuf }
  | "\\'" { Buffer.add_char buf '\''; read_squote_str buf lexbuf }
  | "\\\\" { Buffer.add_char buf '\\'; read_squote_str buf lexbuf }
  | num_esc { add_char_code buf lexbuf; read_squote_str buf lexbuf }
  | [^ ''' '\\']+ { Buffer.add_string buf (lexeme lexbuf);
    read_squote_str buf lexbuf }
  | '\'' { STRING (Buffer.contents buf) }
  | _ { raise (Error(lexbuf_loc lexbuf, IllegalStringCharacter(lexeme lexbuf))) }
