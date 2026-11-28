import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import type { SitemapController } from './sitemap.controller.ts'

/** The website's sitemap entries under `/api/sitemap`. */
export class SitemapRoute implements IRoute {
  readonly path = '/sitemap'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: SitemapController) {
    this.router.get('/', c.get)
  }
}
