#!/usr/bin/env python3
import posixpath
import unittest
from dataclasses import dataclass

class ContractError(ValueError):
    pass

def normalize_unit(unit: str) -> str:
    if not isinstance(unit, str) or not unit.strip():
        raise ContractError("BAD_UNIT")
    return posixpath.normpath(unit.replace("\\", "/"))

@dataclass(frozen=True)
class Case:
    name: str
    tag: int
    payload: str | None = None

@dataclass(frozen=True)
class EnumType:
    unit: str
    owner: str
    cases: tuple[Case, ...]

    @staticmethod
    def make(unit: str, owner: str, cases: list[Case]):
        unit = normalize_unit(unit)
        if not owner:
            raise ContractError("BAD_OWNER")
        if not cases or len(cases) > 4096:
            raise ContractError("BAD_CASE_COUNT")
        seen_names = set()
        seen_tags = set()
        previous = 0
        for case in cases:
            if not case.name or case.name in seen_names:
                raise ContractError("DUPLICATE_CASE")
            if case.tag < 1 or case.tag <= previous or case.tag in seen_tags:
                raise ContractError("BAD_TAG")
            seen_names.add(case.name)
            seen_tags.add(case.tag)
            previous = case.tag
        return EnumType(unit, owner, tuple(cases))

    def case(self, name: str) -> Case:
        for case in self.cases:
            if case.name == name:
                return case
        raise ContractError("UNKNOWN_CASE")

@dataclass(frozen=True)
class Value:
    unit: str
    owner: str
    case: str
    tag: int
    payload: object = None

def construct(enum: EnumType, case_name: str, *args):
    case = enum.case(case_name)
    expected = 0 if case.payload is None else 1
    if len(args) != expected:
        raise ContractError("ARITY")
    return Value(enum.unit, enum.owner, case.name, case.tag, args[0] if args else None)

def value_equal(left: Value, right: Value) -> bool:
    return (
        left.unit == right.unit
        and left.owner == right.owner
        and left.case == right.case
        and left.tag == right.tag
        and left.payload == right.payload
    )

def pattern_matches(enum: EnumType, case_name: str, value: Value) -> bool:
    case = enum.case(case_name)
    return (
        value.unit == enum.unit
        and value.owner == enum.owner
        and value.case == case.name
        and value.tag == case.tag
    )

def shape_return(enum: EnumType, value: Value) -> Value:
    if value.unit != enum.unit or value.owner != enum.owner:
        raise ContractError("NOMINAL_OWNER_MISMATCH")
    case = enum.case(value.case)
    if value.tag != case.tag:
        raise ContractError("NOMINAL_TAG_MISMATCH")
    return value

def exhaustive(enum: EnumType, arms) -> bool:
    covered = {
        (normalize_unit(a["unit"]), a["owner"], a["case"])
        for a in arms
        if not a.get("guard") and a.get("covers_payload", True)
    }
    return all((enum.unit, enum.owner, case.name) in covered for case in enum.cases)

class Oracle(unittest.TestCase):
    def setUp(self):
        cases = [
            Case("INVALID_INPUT", 1),
            Case("STALE_GRAPH", 2),
        ]
        self.local = EnumType.make("/app/main.ores", "TrainingError", cases)
        self.other_unit = EnumType.make("/lib/errors.ores", "TrainingError", cases)
        self.foreign_owner = EnumType.make("/app/main.ores", "ForeignTrainingError", cases)

    def test_same_name_case_tag_from_other_unit_is_distinct(self):
        a = construct(self.local, "INVALID_INPUT")
        b = construct(self.other_unit, "INVALID_INPUT")
        self.assertFalse(value_equal(a, b))

    def test_foreign_owner_same_unit_is_distinct(self):
        a = construct(self.local, "INVALID_INPUT")
        b = construct(self.foreign_owner, "INVALID_INPUT")
        self.assertFalse(value_equal(a, b))

    def test_pattern_requires_unit_owner_case_and_tag(self):
        self.assertTrue(pattern_matches(self.local, "INVALID_INPUT",
                                        construct(self.local, "INVALID_INPUT")))
        self.assertFalse(pattern_matches(self.local, "INVALID_INPUT",
                                         construct(self.other_unit, "INVALID_INPUT")))

    def test_return_shaping_blocks_cross_unit_laundering(self):
        with self.assertRaisesRegex(ContractError, "NOMINAL_OWNER_MISMATCH"):
            shape_return(self.local, construct(self.other_unit, "INVALID_INPUT"))

    def test_detachment_identity_is_stable(self):
        value = construct(self.local, "STALE_GRAPH")
        detached = Value(value.unit, value.owner, value.case, value.tag, value.payload)
        self.assertEqual(value, detached)

    def test_exhaustiveness_is_unit_scoped_and_guard_fail_closed(self):
        complete = [
            {"unit": "/app/main.ores", "owner": "TrainingError", "case": "INVALID_INPUT"},
            {"unit": "/app/main.ores", "owner": "TrainingError", "case": "STALE_GRAPH"},
        ]
        self.assertTrue(exhaustive(self.local, complete))

        wrong_unit = [
            {"unit": "/lib/errors.ores", "owner": "TrainingError", "case": "INVALID_INPUT"},
            {"unit": "/app/main.ores", "owner": "TrainingError", "case": "STALE_GRAPH"},
        ]
        self.assertFalse(exhaustive(self.local, wrong_unit))

        guarded = [
            {"unit": "/app/main.ores", "owner": "TrainingError",
             "case": "INVALID_INPUT", "guard": True},
            {"unit": "/app/main.ores", "owner": "TrainingError", "case": "STALE_GRAPH"},
        ]
        self.assertFalse(exhaustive(self.local, guarded))

    def test_unit_normalization_prevents_alias_spelling_identity_drift(self):
        a = EnumType.make("/app/./types/../main.ores", "TrainingError",
                          [Case("INVALID_INPUT", 1)])
        b = EnumType.make("/app/main.ores", "TrainingError",
                          [Case("INVALID_INPUT", 1)])
        self.assertEqual(a.unit, b.unit)
        self.assertTrue(value_equal(construct(a, "INVALID_INPUT"),
                                    construct(b, "INVALID_INPUT")))

    def test_tags_and_constructor_arity_fail_closed(self):
        with self.assertRaisesRegex(ContractError, "BAD_TAG"):
            EnumType.make("/bad.ores", "Bad", [Case("A", 2), Case("B", 1)])
        with self.assertRaisesRegex(ContractError, "ARITY"):
            construct(self.local, "INVALID_INPUT", 1)

if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(Oracle)
    )
    print("SOURCE_FREE_NOMINAL_ENUM_CASES=" + str(result.testsRun))
    print("PRIVATE_ORESLANG_SOURCE_TRANSFERRED=0")
    print("NATIVE_ORESLANG_COMPILER_EXECUTED=0")
    print("SOURCE_FREE_REFERENCE_ONLY=1")
    raise SystemExit(0 if result.wasSuccessful() else 1)
