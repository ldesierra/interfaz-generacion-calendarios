from backend.app.services.solver_jobs import (
    _TIMEOUT_MESSAGE_NO_SOLUTION,
    _TIMEOUT_MESSAGE_WITH_SOLUTION,
    _classify_solution,
)


def test_classify_proven_optimal():
    assert _classify_solution("Optimal", "Optimal Solution Found", has_solution=True) == (
        "optimal",
        None,
    )


def test_classify_timeout_with_feasible_solution():
    # PuLP reporta status="Optimal" para CBC igual cuando sólo se llegó a una
    # solución entera factible por el límite de tiempo — sol_status es lo
    # único que lo distingue de un óptimo probado (ver docstring de
    # solve.solve_model).
    assert _classify_solution("Optimal", "Solution Found", has_solution=True) == (
        "timeout",
        _TIMEOUT_MESSAGE_WITH_SOLUTION,
    )


def test_classify_infeasible():
    assert _classify_solution("Infeasible", "No Solution Exists", has_solution=False) == (
        "infeasible",
        None,
    )


def test_classify_timeout_without_any_solution():
    assert _classify_solution("Not Solved", "No Solution Found", has_solution=False) == (
        "timeout",
        _TIMEOUT_MESSAGE_NO_SOLUTION,
    )


def test_classify_gurobi_timeout_with_feasible_solution():
    # A diferencia de CBC, pulp.GUROBI reporta status="Not Solved" tanto si
    # truncó con una solución entera ya encontrada como si no encontró
    # ninguna (no distingue por sí solo, ver el comentario junto a
    # `_classify_solution`) — `has_solution` es la señal real acá.
    assert _classify_solution("Not Solved", "No Solution Exists", has_solution=True) == (
        "timeout",
        _TIMEOUT_MESSAGE_WITH_SOLUTION,
    )


def test_classify_unexpected_status_is_an_error():
    status, message = _classify_solution(
        "Unbounded", "Solution is Unbounded", has_solution=False
    )
    assert status == "error"
    assert "Unbounded" in message
