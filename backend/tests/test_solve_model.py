"""Tests de `solve.solve_model` que no dependen de correr un solver real."""

from solve import _hay_asignacion


class _FakeVar:
    def __init__(self, varValue):
        self.varValue = varValue


def test_hay_asignacion_con_una_x_en_uno():
    assert _hay_asignacion([_FakeVar(0.0), _FakeVar(1.0), _FakeVar(0.0)]) is True


def test_no_hay_asignacion_con_todas_las_x_en_cero():
    # HiGHS y CBC dejan todas las variables en 0 cuando cortan sin ninguna
    # solución entera; sin este chequeo pl.value(objetivo) da 0.0 y parece
    # un calendario factible de costo cero.
    assert _hay_asignacion([_FakeVar(0.0), _FakeVar(0.0)]) is False


def test_no_hay_asignacion_con_todas_las_x_en_none():
    # Gurobi, en cambio, las deja en None.
    assert _hay_asignacion([_FakeVar(None), _FakeVar(None)]) is False


def test_hay_asignacion_tolera_el_redondeo_del_solver():
    assert _hay_asignacion([_FakeVar(0.9999999)]) is True
    assert _hay_asignacion([_FakeVar(1e-9)]) is False
