import type { WorkflowStep } from './workflow-definition'

type GraphStep = Pick<WorkflowStep, 'id' | 'dependsOn'>

/** Edges restricted to known, non-self, de-duplicated dependencies. */
export function knownDependencies(steps: readonly GraphStep[]): Map<string, string[]> {
  const ids = new Set(steps.map((step) => step.id))
  const edges = new Map<string, string[]>()
  for (const step of steps) {
    if (edges.has(step.id)) {
      continue
    }
    const deps = [...new Set(step.dependsOn)].filter((dep) => dep !== step.id && ids.has(dep))
    edges.set(step.id, deps)
  }
  return edges
}

/** Each distinct cycle once, as the ordered step ids that form it (first id repeated at the end). */
export function findDependencyCycles(steps: readonly GraphStep[]): string[][] {
  const edges = knownDependencies(steps)
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const cycles: string[][] = []
  const seen = new Set<string>()

  const visit = (id: string): void => {
    state.set(id, 'visiting')
    stack.push(id)
    for (const dep of edges.get(id) ?? []) {
      const depState = state.get(dep)
      if (depState === 'visiting') {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep]
        const key = [...new Set(cycle)].sort().join('|')
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(cycle)
        }
      } else if (depState === undefined) {
        visit(dep)
      }
    }
    stack.pop()
    state.set(id, 'done')
  }

  for (const id of edges.keys()) {
    if (!state.has(id)) {
      visit(id)
    }
  }
  return cycles
}

/** Dependencies-first order; null when the graph has a cycle. Ties keep definition order. */
export function topologicalStepOrder(steps: readonly GraphStep[]): string[] | null {
  const edges = knownDependencies(steps)
  const remaining = new Map([...edges].map(([id, deps]) => [id, new Set(deps)]))
  const order: string[] = []
  while (remaining.size > 0) {
    const next = [...remaining].find(([, deps]) => deps.size === 0)?.[0]
    if (next === undefined) {
      return null
    }
    order.push(next)
    remaining.delete(next)
    for (const deps of remaining.values()) {
      deps.delete(next)
    }
  }
  return order
}

/**
 * Ancestors of `stepId` reachable without passing *through* a step for which `stopAt` is true.
 * Stop steps themselves are not included and their own ancestors are not explored.
 */
export function ancestorsUntil(
  steps: readonly GraphStep[],
  stepId: string,
  stopAt: (id: string) => boolean
): Set<string> {
  const edges = knownDependencies(steps)
  const found = new Set<string>()
  const queue = [...(edges.get(stepId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined || found.has(id) || id === stepId || stopAt(id)) {
      continue
    }
    found.add(id)
    queue.push(...(edges.get(id) ?? []))
  }
  return found
}

/** Layer index per step (longest dependency path from a root); cyclic steps share the last layer. */
export function workflowStepLayers(steps: readonly GraphStep[]): Map<string, number> {
  const edges = knownDependencies(steps)
  const layers = new Map<string, number>()
  const order = topologicalStepOrder(steps)
  if (!order) {
    const fallback = new Map<string, number>()
    steps.forEach((step, index) => fallback.set(step.id, index))
    return fallback
  }
  for (const id of order) {
    const deps = edges.get(id) ?? []
    layers.set(id, deps.length === 0 ? 0 : Math.max(...deps.map((dep) => layers.get(dep) ?? 0)) + 1)
  }
  return layers
}

/** Direct dependents of each step, in definition order. */
export function directDependents(steps: readonly GraphStep[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>(steps.map((step) => [step.id, []]))
  for (const [id, deps] of knownDependencies(steps)) {
    for (const dep of deps) {
      dependents.get(dep)?.push(id)
    }
  }
  return dependents
}
