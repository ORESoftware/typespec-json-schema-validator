#!/usr/bin/env python3
import hashlib
import pathlib
import re
import unittest

class BadSyntax(ValueError):
    pass

def mask_noncode(text):
    out = list(text)
    i = 0
    quote = None
    block = 0
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ""
        if block:
            if c == "*" and n == "/":
                out[i] = out[i + 1] = " "
                block -= 1
                i += 2
                continue
            if c != "\n":
                out[i] = " "
            i += 1
            continue
        if quote is not None:
            if c == "\\":
                out[i] = " "
                if i + 1 < len(text) and text[i + 1] != "\n":
                    out[i + 1] = " "
                i += 2
                continue
            if c == quote:
                out[i] = " "
                quote = None
            elif c != "\n":
                out[i] = " "
            i += 1
            continue
        if c == "/" and n == "/":
            while i < len(text) and text[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if c == "/" and n == "*":
            out[i] = out[i + 1] = " "
            block += 1
            i += 2
            continue
        if c in ('"', "'", "`"):
            out[i] = " "
            quote = c
        i += 1
    if block or quote is not None:
        raise BadSyntax("unterminated comment or literal")
    return "".join(out)

def fn_type(text):
    text = re.sub(r"\s+", " ", text.strip())
    def parse(s):
        s = s.strip()
        if s.startswith("("):
            depth = 0
            close = None
            for i,ch in enumerate(s):
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        close = i
                        break
            if close is None:
                raise BadSyntax("unclosed type")
            inside = s[1:close].strip()
            rest = s[close+1:].strip()
            if rest.startswith("=>"):
                args = tuple(x.strip() for x in inside.split(",") if x.strip())
                return ("fn", args, parse(rest[2:]))
            if rest:
                raise BadSyntax("trailing grouped type tokens")
            return parse(inside)
        if "=>" in s:
            raise BadSyntax("function type parameters require parentheses")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s):
            raise BadSyntax("bad type")
        return ("name", s)
    return parse(text)

def normalize_body(text):
    text = mask_noncode(text)
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|>=|<=|[()><,+*/-]", text.replace(";", " "))
    depth = 0
    for t in tokens:
        if t == "if":
            depth += 1
        elif t == "fi":
            depth -= 1
            if depth < 0:
                raise BadSyntax("unmatched fi")
    if depth:
        raise BadSyntax("missing fi")
    return tuple(tokens)

def definition(src):
    s = src.strip()
    if re.match(r"^(actor|isoactor|static|abstract)\b", s):
        raise BadSyntax("unsupported context")
    m = re.match(r"^(?:[A-Za-z_][A-Za-z0-9_]*\s+)*(fnc|routine)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*->\s*(.*)$", s, re.S)
    if not m:
        raise BadSyntax("missing slim-arrow header")
    rest = m.group(3)
    visible = mask_noncode(rest)
    p = visible.find("\n")
    header_visible = visible if p < 0 else visible[:p]
    dm = re.search(r"\bdo\b", header_visible)
    if dm:
        typ = mask_noncode(rest[:dm.start()]).strip()
        tail = rest[dm.end():]
    else:
        if p < 0:
            raise BadSyntax("same-line body requires do")
        typ = mask_noncode(rest[:p]).strip()
        tail = rest[p+1:]
    if not typ or typ.endswith(";"):
        raise BadSyntax("invalid return boundary")
    visible_tail = mask_noncode(tail)
    end_matches = list(re.finditer(r"\bend\b", visible_tail))
    if not end_matches:
        raise BadSyntax("missing end")
    closer = end_matches[-1]
    if visible_tail[closer.end():].strip():
        raise BadSyntax("trailing syntax after end")
    body = tail[:closer.start()].strip()
    return (m.group(1), m.group(2), fn_type(typ), normalize_body(body))

def signature(src):
    s = src.strip()
    if re.search(r"\bdo\b", s):
        raise BadSyntax("do is not a signature boundary")
    m = re.match(r"^(fnc|routine)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*->\s*(.*?)\s*;\s*$", s, re.S)
    if not m:
        raise BadSyntax("bad signature")
    return (m.group(2), fn_type(m.group(3)))

class Oracle(unittest.TestCase):
    def test_optional_do_same_structure(self):
        a = definition("fnc identity(int x) -> int\nreturn x\nend")
        b = definition("fnc identity(int x) -> int do return x; end")
        self.assertEqual(a, b)

    def test_compact_if_same_structure(self):
        a = definition("fnc f(int x) -> int\nif x > 0 then return 1 else return 0 fi\nend")
        b = definition("fnc f(int x) -> int do if x > 0 then return 1; else return 0; fi end")
        self.assertEqual(a, b)

    def test_right_associative_function_type(self):
        self.assertEqual(
            fn_type("(int) => (string) => bool"),
            ("fn", ("int",), ("fn", ("string",), ("name", "bool")))
        )

    def test_zero_arg_function_type(self):
        self.assertEqual(fn_type("() => void"), ("fn", (), ("name", "void")))

    def test_compact_higher_order_definition(self):
        got = definition("fnc callback() -> () => void do return factory(); end")
        self.assertEqual(got[2], ("fn", (), ("name", "void")))


    def test_parentheses_required_for_function_type(self):
        with self.assertRaises(BadSyntax):
            fn_type("int => string")

    def test_misplaced_do_rejected(self):
        with self.assertRaises(BadSyntax):
            definition("fnc bad() -> do return 1; end")

    def test_missing_arrow_rejected(self):
        with self.assertRaises(BadSyntax):
            definition("fnc bad() int do return 1; end")

    def test_same_line_without_do_rejected(self):
        with self.assertRaises(BadSyntax):
            definition("fnc bad() -> int return 1; end")

    def test_semicolon_not_body_boundary(self):
        with self.assertRaises(BadSyntax):
            definition("fnc bad() -> int; return 1; end")

    def test_contract_signature_can_return_function(self):
        self.assertEqual(signature("fnc make() -> () => void;")[1], ("fn", (), ("name", "void")))

    def test_contract_do_rejected(self):
        with self.assertRaises(BadSyntax):
            signature("fnc make() -> () => void do return cb; end")

    def test_actor_and_static_rejected(self):
        for src in (
            "actor fnc run() -> int do return 1; end",
            "static fnc run() -> int do return 1; end",
        ):
            with self.subTest(src=src), self.assertRaises(BadSyntax):
                definition(src)

    def test_missing_fi_rejected(self):
        with self.assertRaises(BadSyntax):
            definition("fnc f(int x) -> int do if x > 0 then return 1; end")

    def test_comments_and_literals_do_not_own_boundaries(self):
        got = definition(
            'fnc value() -> int /* ; do end */ do /* end */ return 7; end // do end'
        )
        self.assertEqual(got[2], ("name", "int"))
        text = definition('fnc text() -> string do return "do end fi;"; end')
        self.assertEqual(text[2], ("name", "string"))

    def test_semicolon_hidden_in_comment_is_not_signature_terminator(self):
        got = definition("fnc value() -> int /* ; */ do return 7; end")
        self.assertEqual(got[2], ("name", "int"))

    def test_next_line_do_belongs_to_body_not_header(self):
        got = definition("fnc consume() -> void\ndo select token\nend")
        self.assertEqual(got[3][0], "do")

    def test_compact_routine_uses_same_boundary_rules(self):
        got = definition("routine identity(int x) -> int do return x; end")
        self.assertEqual(got[0], "routine")
        self.assertEqual(got[2], ("name", "int"))

    def test_shared_roundtrip_corpus_has_expected_git_blob(self):
        path = pathlib.Path(__file__).with_name("sourcefree_fnc_roundtrip_20261019.ores")
        data = path.read_bytes()
        digest = hashlib.sha1(
            b"blob " + str(len(data)).encode("ascii") + b"\\0" + data
        ).hexdigest()
        self.assertEqual(digest, "5d9384b6d2acfd6d21a805315fed4bd7518022b1")
        text = data.decode("utf-8")
        self.assertIn("fnc callback() -> () => void do", text)
        self.assertIn("fnc text() -> string /* ; do end */ do", text)




if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Oracle))
    print("SOURCE_FREE_FUNCTION_SYNTAX_CASES=" + str(result.testsRun))
    print("SOURCE_FREE_REFERENCE_ONLY=1")
    raise SystemExit(0 if result.wasSuccessful() else 1)
