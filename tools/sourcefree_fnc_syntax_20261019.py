#!/usr/bin/env python3
import re
import unittest

class BadSyntax(ValueError):
    pass

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
    dm = re.search(r"\bdo\b", rest)
    if dm:
        typ = rest[:dm.start()].strip()
        tail = rest[dm.end():].strip()
    else:
        p = rest.find("\n")
        if p < 0:
            raise BadSyntax("same-line body requires do")
        typ = rest[:p].strip()
        tail = rest[p+1:].strip()
    if not typ or typ.endswith(";"):
        raise BadSyntax("invalid return boundary")
    if not re.search(r"\bend\s*$", tail):
        raise BadSyntax("missing end")
    body = re.sub(r"\bend\s*$", "", tail).strip()
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

if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Oracle))
    print("SOURCE_FREE_FUNCTION_SYNTAX_CASES=" + str(result.testsRun))
    print("SOURCE_FREE_REFERENCE_ONLY=1")
    raise SystemExit(0 if result.wasSuccessful() else 1)
