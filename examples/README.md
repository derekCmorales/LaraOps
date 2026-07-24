# Examples (payloads listos)

Cada archivo es el body JSON de `POST /api/v1/modules/<mod>/solve`.

| Archivo | Módulo |
|---|---|
| `eoq_01.json` | eoq |
| `lp_01.json` | lp |
| `transport_01.json` | transport |
| `pert_01.json` | pert_cpm |
| `queues_01.json` | queues |
| `networks_shortest.json` | networks |
| `markov_01.json` | markov |
| `quality_c.json` | quality_control |
| `goal_01.json` | goal_programming |
| `dp_knapsack.json` | dynamic_programming |
| `mrp_01.json` | mrp |
| `assignment_01.json` | assignment |
| `forecasting_01.json` | forecasting |
| `decision_01.json` | decision_analysis |
| `game_01.json` | game_theory |
| `inventory_01.json` | inventory |
| `breakeven_01.json` | breakeven |
| `statistics_01.json` | statistics |
| `asa_01.json` | acceptance_sampling |
| `decision_tree_01.json` | decision_analysis (tree) |
| `decision_bayes_01.json` | decision_analysis (bayes) |
| `pert_crash_01.json` | pert_cpm (crashing) |

En la UI, los módulos núcleo (EOQ, LP, Transporte, Asignación, PERT) usan **hoja editable**; estos JSON sirven para curl, tests y “Modo experto”.

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/modules/lp/solve \
  -H 'content-type: application/json' \
  -d @examples/lp_01.json

curl -s -X POST http://127.0.0.1:8000/api/v1/modules/lp/export.pdf \
  -H 'content-type: application/json' \
  -d @examples/lp_01.json -o /tmp/lp.pdf
```
