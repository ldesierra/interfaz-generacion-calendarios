"""Diagnóstico de infactibilidad para casos con UCs fijas (las preasignaciones
del caso derivado de la edición incremental: un único slot cuando el calendario
vigente trae día y turno, o todos los turnos de un día cuando viene de la
planilla vieja, que sólo trae el día).

El modelo (`solve.py`) sólo dice "Infeasible". Acá se chequean en Python, sin
resolver nada, las restricciones que se pueden evaluar mirando slots:

* a lo sumo `MAX_EVALUACIONES_TURNO` evaluaciones por turno (y, para las UCs
  fijas sólo al día, por día entre todos sus turnos);
* capacidad (`sum inscriptos <= capacidad * fac_cp`), por turno y por día;
* UCs con profesores en común no pueden coincidir en el mismo turno;
* UCs sugeridas en el mismo semestre y carrera, en días distintos;
* si dos UCs tienen `coincidencia >= alta_co`, separación mínima de 2 en
  `time_value` (día + turno/(max_turnos+1)).

Con eso se separan dos situaciones muy distintas para el usuario:

1. el calendario vigente (lo fijo) ya viola alguna restricción → ningún cambio
   lo arregla, hay que corregir los datos o el calendario;
2. lo fijo es consistente pero a alguna UC libre no le queda ningún slot.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

from csv_data_to_model_data import load_calendar_data

# Mismo valor que la restricción MaximaEvaluacionesTurno de solve.py.
MAX_EVALUACIONES_TURNO = 6
# Separación mínima (en unidades de time_value) de la restricción Separacion_Minima de solve.py.
SEPARACION_MINIMA = 2

MAX_LISTED = 8


class _Model:
    def __init__(self, data: dict):
        self.desc = {str(k): v for k, v in data["uc_descriptions"].items()}
        self.slots = [(int(d), int(t)) for d in data["D"] for t in data["Td"][d]]
        self.tv = {(int(d), int(t)): v for (d, t), v in data["time_value"].items()}
        self.cp = {(int(d), int(t)): float(v) for (d, t), v in data["cp"].items()}
        self.fac_cp = data["fac_cp"]
        self.alta_co = data["alta_co"]
        self.ins = {str(c): float(v) for c, v in data["ins"].items()}
        self.co = {(str(a), str(b)): float(v) for (a, b), v in data["co"].items()}
        self.cop = defaultdict(set)
        for a, b in data["COP"]:
            self.cop[str(a)].add(str(b))
            self.cop[str(b)].add(str(a))
        self.groups = [[str(c) for c in g] for g in data["GRUPOS_MISMO_SEMESTRE"]]
        self.pares = {frozenset((str(a), str(b))) for a, b in data["PARES_UC"]}
        self.ucs = [str(c) for c in data["C"]]
        self.turnos_por_dia = Counter(d for d, _ in self.slots)
        self.pa = {
            str(c): [(int(d), int(t)) for d, t in slots] for c, slots in data["PA"].items()
        }
        # Fijas a día y turno: preasignación de un único slot.
        self.fixed = {c: s[0] for c, s in self.pa.items() if len(s) == 1}
        # Fijas al día: toda la preasignación cae en un mismo día y el modelo
        # elige el turno (es lo que produce la planilla vieja, que no trae
        # turno). Incluye a las anteriores. Con días distintos permitidos la UC
        # no está fija, se trata como libre.
        self.fixed_day = {c: s[0][0] for c, s in self.pa.items() if len({d for d, _ in s}) == 1}
        self.free = [c for c in self.ucs if c not in self.fixed_day]

    def name(self, uc: str) -> str:
        return self.desc.get(uc, uc)

    def too_close(self, a: str, b: str, sa, sb) -> bool:
        return (
            frozenset((a, b)) in self.pares
            and self.co.get((a, b), 0) >= self.alta_co
            and abs(self.tv[sa] - self.tv[sb]) < SEPARACION_MINIMA
        )

    def group_mates(self, uc: str) -> set[str]:
        return {o for g in self.groups if uc in g for o in g if o != uc}

    def max_separacion(self, a: str, b: str) -> float:
        """La mayor separación en `time_value` que el modelo puede darle al par
        eligiendo entre los slots permitidos de cada UC."""
        return max(abs(self.tv[sa] - self.tv[sb]) for sa in self.pa[a] for sb in self.pa[b])

    def muy_cerca(self, a: str, b: str) -> bool:
        return (
            frozenset((a, b)) in self.pares
            and self.co.get((a, b), 0) >= self.alta_co
            and self.max_separacion(a, b) < SEPARACION_MINIMA
        )

    def lugar(self, uc: str) -> str:
        """Dónde quedó la UC: con turno si está fija al slot, sólo el día si el
        modelo todavía elige el turno."""
        slot = self.fixed.get(uc)
        return _slot_label(slot) if slot else f"Día {self.fixed_day[uc]}"


def _slot_label(slot) -> str:
    return f"Día {slot[0]} Turno {slot[1]}"


def fixed_conflicts(m: _Model) -> list[str]:
    """Violaciones entre las UCs fijas (no dependen de ninguna UC libre)."""
    by_slot: dict[tuple[int, int], list[str]] = defaultdict(list)
    for uc, slot in m.fixed.items():
        by_slot[slot].append(uc)

    out: list[str] = []
    for slot, ucs in sorted(by_slot.items()):
        if len(ucs) > MAX_EVALUACIONES_TURNO:
            out.append(
                f"{_slot_label(slot)} tiene {len(ucs)} evaluaciones y el máximo por turno es "
                f"{MAX_EVALUACIONES_TURNO}."
            )
        total = sum(m.ins.get(u, 0) for u in ucs)
        limit = m.cp.get(slot, float("inf")) * m.fac_cp
        if total > limit:
            out.append(
                f"{_slot_label(slot)} supera la capacidad: {total:g} inscriptos para {limit:g} lugares."
            )
        for a, b in combinations(sorted(ucs), 2):
            if b in m.cop[a]:
                out.append(
                    f"{m.name(a)} y {m.name(b)} comparten profesor y están en el mismo turno "
                    f"({_slot_label(slot)})."
                )
    # Lo que sigue sólo depende del día, así que también alcanza a las UCs
    # fijadas al día sin turno (planilla vieja).
    por_dia: Counter[int] = Counter(m.fixed_day.values())
    for dia, cuantas in sorted(por_dia.items()):
        tope = MAX_EVALUACIONES_TURNO * m.turnos_por_dia[dia]
        if cuantas > tope:
            out.append(
                f"Día {dia} tiene {cuantas} evaluaciones y entre sus {m.turnos_por_dia[dia]} "
                f"turnos entran {tope}."
            )
        inscriptos = sum(m.ins.get(u, 0) for u, d in m.fixed_day.items() if d == dia)
        lugares = sum(m.cp.get(s, 0) for s in m.slots if s[0] == dia) * m.fac_cp
        if inscriptos > lugares:
            out.append(
                f"Día {dia} supera la capacidad: {inscriptos:g} inscriptos para {lugares:g} "
                f"lugares entre todos sus turnos."
            )

    for g in m.groups:
        en_grupo = [(u, m.fixed_day[u]) for u in g if u in m.fixed_day]
        for (a, da), (b, db) in combinations(en_grupo, 2):
            if da == db:
                out.append(
                    f"{m.name(a)} y {m.name(b)} son del mismo semestre y carrera pero están el "
                    f"mismo día (Día {da})."
                )
    for a, b in combinations(sorted(m.fixed_day), 2):
        if m.muy_cerca(a, b):
            out.append(
                f"{m.name(a)} ({m.lugar(a)}) y {m.name(b)} ({m.lugar(b)}) tienen muchos "
                f"estudiantes en común ({m.co[(a, b)]:g}) y están demasiado cerca: necesitan al "
                f"menos {SEPARACION_MINIMA} días de separación."
            )
    return out


def _blockers(m: _Model, uc: str, slot) -> list[tuple[str, str | None]]:
    """Motivos por los que la UC libre `uc` no puede ir en `slot`, dadas las fijas."""
    reasons: list[tuple[str, str | None]] = []
    here = [u for u, s in m.fixed.items() if s == slot]
    if len(here) >= MAX_EVALUACIONES_TURNO:
        reasons.append(("turno_lleno", None))
    if m.ins.get(uc, 0) + sum(m.ins.get(u, 0) for u in here) > m.cp.get(slot, float("inf")) * m.fac_cp:
        reasons.append(("capacidad", None))
    for u in here:
        if u in m.cop[uc]:
            reasons.append(("profesor", u))
    mates = m.group_mates(uc)
    for u in mates:
        if u in m.fixed and m.fixed[u][0] == slot[0]:
            reasons.append(("semestre", u))
    for u, s in m.fixed.items():
        if m.too_close(uc, u, slot, s):
            reasons.append(("cercania", u))
    return reasons


_REASON_TEXT = {
    "turno_lleno": "turnos ya llenos ({n})",
    "capacidad": "turnos sin capacidad suficiente ({n})",
    "profesor": "turnos con una UC que comparte profesor ({n}){who}",
    "semestre": "días con una UC del mismo semestre y carrera ({n}){who}",
    "cercania": "slots demasiado cerca de una UC con muchos estudiantes en común ({n}){who}",
}


def free_uc_problems(m: _Model) -> list[str]:
    """UCs libres a las que no les queda ningún slot posible."""
    out: list[str] = []
    for uc in m.free:
        counts: Counter[str] = Counter()
        who: dict[str, Counter[str]] = defaultdict(Counter)
        available = 0
        for slot in m.slots:
            reasons = _blockers(m, uc, slot)
            if not reasons:
                available += 1
            for kind, other in {r for r in reasons}:
                counts[kind] += 1
                if other:
                    who[kind][other] += 1
        if available:
            continue
        parts = []
        for kind, n in counts.most_common():
            names = ", ".join(m.name(u) for u, _ in who[kind].most_common(3))
            parts.append(
                _REASON_TEXT[kind].format(n=n, who=f": {names}" if names else "")
            )
        out.append(f"No hay ningún día/turno posible para {m.name(uc)}. Motivos — " + "; ".join(parts) + ".")
    return out


def _fixed_report(m: _Model) -> list[str]:
    conflicts = fixed_conflicts(m)
    if not conflicts:
        return []
    listed = conflicts[:MAX_LISTED]
    extra = len(conflicts) - len(listed)
    header = (
        "El calendario vigente ya incumple restricciones del modelo con los datos cargados, "
        "así que ningún cambio puede resolverlo. Revisá los datos (capacidad, alta_co, "
        "profesores, trayectoria) o el calendario:"
    )
    return [header, *listed, *([f"…y {extra} más."] if extra > 0 else [])]


def fixed_conflict_report(case_path: str | Path) -> list[str]:
    """Mensajes sobre violaciones entre las UCs fijas; vacío si no hay."""
    return _fixed_report(_Model(load_calendar_data(str(case_path))))


def diagnose(case_path: str | Path) -> list[str]:
    """Mensajes en español que explican por qué el caso es infactible.

    Lista vacía si no se pudo determinar una causa puntual."""
    m = _Model(load_calendar_data(str(case_path)))

    report = _fixed_report(m)
    if report:
        return report

    problems = free_uc_problems(m)
    if problems:
        return problems

    if len(m.free) > 1:
        return [
            "Cada UC a ubicar tiene lugares posibles por separado, pero no hay una combinación "
            "que cumpla todas las restricciones a la vez (por ejemplo, UCs nuevas del mismo "
            "semestre o con profesores en común entre sí)."
        ]
    return []
