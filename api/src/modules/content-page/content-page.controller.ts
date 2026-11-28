import type { Request, Response } from 'express'
import type {
  ContentPageDetail,
  ContentPageList,
  ContentPageVersion,
  ContentPageVersionList,
  PublishedPage,
  PublishedPageList,
} from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import type { ContentPageService } from './content-page.service.ts'
import { CreateContentPageDto, PageParams, SlugParams, UpdateContentPageDto, VersionParams } from './dto/index.ts'

export class ContentPageController {
  constructor(private readonly service: ContentPageService) {}

  // ===== Admin =====

  list = async (_req: Request, res: Response) => {
    const body: ContentPageList = { items: await this.service.list() }
    res.json(body)
  }

  create = async (req: Request, res: Response) => {
    const body: ContentPageDetail = await this.service.create(parse(CreateContentPageDto, req.body), contextOf(req))
    res.status(201).json(body)
  }

  detail = async (req: Request, res: Response) => {
    const body: ContentPageDetail = await this.service.get(parse(PageParams, req.params).id)
    res.json(body)
  }

  update = async (req: Request, res: Response) => {
    const { id } = parse(PageParams, req.params)
    const input = parse(UpdateContentPageDto, req.body)
    const body: ContentPageDetail = await this.service.update(id, input, contextOf(req))
    res.json(body)
  }

  publish = async (req: Request, res: Response) => {
    const body: ContentPageVersion = await this.service.publish(parse(PageParams, req.params).id, contextOf(req))
    res.json(body)
  }

  versions = async (req: Request, res: Response) => {
    const body: ContentPageVersionList = { items: await this.service.versions(parse(PageParams, req.params).id) }
    res.json(body)
  }

  version = async (req: Request, res: Response) => {
    const { id, version } = parse(VersionParams, req.params)
    const body: ContentPageVersion = await this.service.version(id, version)
    res.json(body)
  }

  // ===== Public =====

  publicList = async (_req: Request, res: Response) => {
    const body: PublishedPageList = await this.service.publicList()
    res.json(body)
  }

  publicPage = async (req: Request, res: Response) => {
    const body: PublishedPage = await this.service.publicPage(parse(SlugParams, req.params).slug)
    res.json(body)
  }
}
