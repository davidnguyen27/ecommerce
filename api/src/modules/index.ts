import type { AppDeps } from '../app.ts'
import type { BaseModule } from '../core/module/base.module.ts'
import { CategoryModule } from './category/index.ts'

/**
 * Builds every module in dependency order: a module that needs another's query interface is built after it and gets
 * it in its constructor.
 */
export function createModules(deps: AppDeps): BaseModule[] {
  return [new CategoryModule(deps)]
}
