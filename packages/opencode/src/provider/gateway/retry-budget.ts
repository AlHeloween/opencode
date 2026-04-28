export interface RetryBudget {
  totalRequests: number
  retryRequests: number
  budgetPercent: number
}

export interface RetryBudgetConfig {
  budgetPercent: number
  minRetriesPerSecond: number
}

const DEFAULT_CONFIG: RetryBudgetConfig = {
  budgetPercent: 0.2,
  minRetriesPerSecond: 10,
}

export function make(): RetryBudget {
  return {
    totalRequests: 0,
    retryRequests: 0,
    budgetPercent: DEFAULT_CONFIG.budgetPercent,
  }
}

export function recordRequest(budget: RetryBudget): RetryBudget {
  return {
    ...budget,
    totalRequests: budget.totalRequests + 1,
  }
}

export function recordRetry(budget: RetryBudget): RetryBudget {
  return {
    ...budget,
    retryRequests: budget.retryRequests + 1,
  }
}

export function canRetry(budget: RetryBudget, config: RetryBudgetConfig = DEFAULT_CONFIG): boolean {
  const maxRetries = Math.max(config.minRetriesPerSecond, Math.floor(budget.totalRequests * config.budgetPercent))
  return budget.retryRequests < maxRetries
}

export function reset(budget: RetryBudget): RetryBudget {
  return {
    ...budget,
    totalRequests: 0,
    retryRequests: 0,
  }
}

export function getMetrics(budget: RetryBudget): { canRetry: boolean; retryRate: number } {
  const maxRetries = Math.max(
    DEFAULT_CONFIG.minRetriesPerSecond,
    Math.floor(budget.totalRequests * budget.budgetPercent),
  )
  return {
    canRetry: budget.retryRequests < maxRetries,
    retryRate: budget.totalRequests > 0 ? budget.retryRequests / budget.totalRequests : 0,
  }
}
