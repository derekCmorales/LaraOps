from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class QueuesRequest(BaseModel):
    """Petición de teoría de colas.

    Los campos se aceptan sin restricciones de Pydantic para que el solver
    responda con mensajes en español (HTTP 400) en lugar de errores 422 genéricos.
    """

    model: str
    lambda_: Any = Field(default=None, alias="lambda", description="Tasa de llegada λ")
    mu: Any = Field(default=None, description="Tasa de servicio μ por servidor")
    s: Any = Field(default=None, description="Número de servidores (modelos M/M/s…)")
    K: Any = Field(default=None, description="Capacidad máxima del sistema (M/M/1/K, M/M/s/K)")
    N: Any = Field(default=None, description="Tamaño de la población (M/M/s/N, población finita)")
    service_std_dev: Any = Field(
        default=None, description="Desviación estándar del tiempo de servicio σ (M/G/1)"
    )
    include_pn: bool = True

    cost_waiting_per_unit_time: Any = Field(default=None, description="Costo de espera por cliente")
    cost_server_per_unit_time: Any = Field(default=None, description="Costo por servidor")
    waiting_cost_basis: Any = Field(
        default="system", description="«system» cobra la espera sobre L; «queue» sobre Lq"
    )
    optimize_s: bool = Field(
        default=False, description="Compara el costo total para distintos números de servidores"
    )
    s_max: Any = Field(default=None, description="Máximo de servidores a comparar")
    wait_threshold: Any = Field(
        default=None, description="Tiempo t para calcular P(Wq > t) y P(W > t)"
    )
    time_unit: Any = Field(default=None, description="Etiqueta de la unidad de tiempo (solo informativa)")

    model_config = {"populate_by_name": True}
