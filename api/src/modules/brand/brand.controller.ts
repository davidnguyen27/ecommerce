import type { Request, Response } from 'express'
import type { AdminBrand, AdminBrandList, PublicBrand, PublicBrandList } from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import { contextOf } from '../../core/context/request-context.ts'
import { BaseCrudController } from '../../core/controller/base-crud.controller.ts'
import { uploadedFile } from '../../core/media/images.ts'
import { parse } from '../../core/middleware/validation.ts'
import type { Brand } from '../../generated/prisma/client.ts'
import { BrandDto, BrandParams, SlugParams } from './dto/index.ts'
import { toAdminBrand, toPublicBrand } from './brand.mapper.ts'
import type { BrandService } from './brand.service.ts'

export class BrandController extends BaseCrudController<Brand, typeof BrandDto, typeof BrandDto, AdminBrand> {
  constructor(
    protected override readonly service: BrandService,
    private readonly storage: Storage,
  ) {
    super(service, { create: BrandDto, update: BrandDto }, (brand) => toAdminBrand(storage, brand))
  }

  protected override idOf(req: Request) {
    return parse(BrandParams, req.params).id
  }

  // ===== Admin =====

  list = async (_req: Request, res: Response) => {
    const body: AdminBrandList = { items: (await this.service.list()).map(this.toBody) }
    res.json(body)
  }

  hide = async (req: Request, res: Response) => {
    const body: AdminBrand = this.toBody(await this.service.hide(this.idOf(req), contextOf(req)))
    res.json(body)
  }

  unhide = async (req: Request, res: Response) => {
    const body: AdminBrand = this.toBody(await this.service.unhide(this.idOf(req), contextOf(req)))
    res.json(body)
  }

  uploadLogo = async (req: Request, res: Response) => {
    const id = this.idOf(req)
    const file = uploadedFile(req)
    const body: AdminBrand = this.toBody(await this.service.uploadLogo(id, file, contextOf(req), req.log))
    res.json(body)
  }

  deleteLogo = async (req: Request, res: Response) => {
    const body: AdminBrand = this.toBody(await this.service.setLogo(this.idOf(req), null, contextOf(req), req.log))
    res.json(body)
  }

  // ===== Public =====

  publicList = async (_req: Request, res: Response) => {
    const body: PublicBrandList = { items: await this.service.publicList() }
    res.json(body)
  }

  publicDetail = async (req: Request, res: Response) => {
    const { slug } = parse(SlugParams, req.params)
    const body: PublicBrand = toPublicBrand(this.storage, await this.service.publicBrand(slug))
    res.json(body)
  }
}
