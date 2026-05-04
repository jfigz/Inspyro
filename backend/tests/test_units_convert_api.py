import math
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app


def test_units_convert_api_success() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 1.5, "from_unit": "kN", "to_unit": "N"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["from_unit"] == "kN"
    assert payload["to_unit"] == "N"
    assert math.isclose(payload["converted_magnitude"], 1500.0, rel_tol=0, abs_tol=1e-9)
    assert payload["category"] == "Fuerza"
    assert "canonical" in payload
    assert payload["canonical"]["from_unit"] == "kN"
    assert payload["dimension"]


def test_units_convert_api_incompatible_units() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 1, "from_unit": "kN", "to_unit": "s"},
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["error_code"] == "incompatible_units"
    assert "details" in payload


def test_units_convert_api_invalid_payload() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"from_unit": "kN", "to_unit": "N"},
    )
    assert response.status_code == 422
    payload = response.json()
    assert payload["error_code"] == "invalid_payload"


def test_units_convert_api_unknown_unit() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 1, "from_unit": "foo_unit", "to_unit": "N"},
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["error_code"] == "unknown_unit"


def test_units_convert_api_accepts_superscript_units() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 3.2, "from_unit": "m/s²", "to_unit": "ft/s²"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["to_unit"] == "ft/s²"
    assert math.isclose(payload["converted_magnitude"], 10.498687664, rel_tol=0, abs_tol=1e-6)


def test_units_convert_api_alias_conflicts_tonf_tf() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 1.0, "from_unit": "tonf", "to_unit": "kN"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["canonical"]["from_unit"] in {"tonf", "tf"}
    assert math.isclose(payload["converted_magnitude"], 9.80665, rel_tol=0, abs_tol=1e-4)


def test_units_convert_api_alias_conflicts_rpm_turn_min() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 60.0, "from_unit": "rpm", "to_unit": "turn/min"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert math.isclose(payload["converted_magnitude"], 60.0, rel_tol=0, abs_tol=1e-9)


def test_units_convert_api_alias_conflicts_nm_mdotn() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": 10.0, "from_unit": "Nm", "to_unit": "m·N"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert math.isclose(payload["converted_magnitude"], 10.0, rel_tol=0, abs_tol=1e-9)


def test_units_convert_api_vector_payload() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": [1, 2, 3], "from_unit": "kN", "to_unit": "N"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["converted_magnitude"] == [1000.0, 2000.0, 3000.0]


def test_units_convert_api_matrix_payload() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={"magnitude": [[1, 2], [3, 4]], "from_unit": "m", "to_unit": "cm"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["converted_magnitude"] == [[100.0, 200.0], [300.0, 400.0]]


def test_units_convert_api_uncertainty_scalar_temperature_is_stable() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={
            "magnitude": 25.0,
            "from_unit": "degC",
            "to_unit": "K",
            "uncertainty": 0.1,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["converted_uncertainty"] == 0.1


def test_units_convert_api_uncertainty_vector_and_matrix_keep_shape() -> None:
    client = TestClient(app)
    vector_response = client.post(
        "/api/units/convert",
        json={
            "magnitude": [25.0, 30.0],
            "from_unit": "degC",
            "to_unit": "K",
            "uncertainty": [0.1, 0.2],
        },
    )
    assert vector_response.status_code == 200
    vector_payload = vector_response.json()
    assert vector_payload["converted_uncertainty"] == [0.1, 0.2]

    matrix_response = client.post(
        "/api/units/convert",
        json={
            "magnitude": [[25.0, 30.0], [10.0, 15.0]],
            "from_unit": "degC",
            "to_unit": "K",
            "uncertainty": [[0.1, 0.2], [0.3, 0.4]],
        },
    )
    assert matrix_response.status_code == 200
    matrix_payload = matrix_response.json()
    assert matrix_payload["converted_uncertainty"] == [[0.1, 0.2], [0.3, 0.4]]


def test_units_convert_api_uncertainty_respects_significant_figures_option() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/units/convert",
        json={
            "magnitude": 1.0,
            "from_unit": "m",
            "to_unit": "cm",
            "uncertainty": 0.123456789012345,
            "options": {
                "significant_figures": 4,
            },
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["converted_uncertainty"] == 12.35


def test_units_catalog_endpoint() -> None:
    client = TestClient(app)
    response = client.get("/api/units/catalog")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] > 0
    assert "units" in payload
    assert any(item.get("canonical") == "kN" for item in payload["units"])


def test_units_compatible_endpoint() -> None:
    client = TestClient(app)
    response = client.post("/api/units/compatible", json={"unit": "kN"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["dimension"]
    assert "compatible_units" in payload
    assert "N" in payload["compatible_units"]
    assert "lbf" in payload["compatible_units"]
