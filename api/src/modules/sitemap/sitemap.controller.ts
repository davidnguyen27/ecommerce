import type { Request, Response } from 'express'
import type { Sitemap } from '@ecommerce/shared'
import type { SitemapService } from './sitemap.service.ts'

export class SitemapController {
  constructor(private readonly service: SitemapService) {}

  get = async (_req: Request, res: Response) => {
    const body: Sitemap = await this.service.build()
    res.json(body)
  }
}
