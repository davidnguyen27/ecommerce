import type { AppDeps } from '../app.ts'
import type { BaseModule } from '../core/module/base.module.ts'

/**
 * Builds every module in dependency order: a module that needs another's query interface is built after it and gets
 * it in its constructor. Empty until the first module moves over (spec kien-truc-module-nhieu-lop).
 */
export function createModules(_deps: AppDeps): BaseModule[] {
  return []
}
