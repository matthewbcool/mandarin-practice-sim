import type { ScenarioDefinition, ScenarioId } from "./types";
import { bobaTeaShopScenario } from "./bobaTeaShop";

export const scenarios: ScenarioDefinition[] = [bobaTeaShopScenario];

export const defaultScenario = bobaTeaShopScenario;

export function getScenarioById(id: ScenarioId): ScenarioDefinition {
  return scenarios.find((scenario) => scenario.id === id) ?? defaultScenario;
}

export const scenarioCards = scenarios.map((scenario) => scenario.card);
