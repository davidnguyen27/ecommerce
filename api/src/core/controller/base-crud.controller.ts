import type { Request, Response } from 'express'
import type { z } from 'zod'
import { contextOf } from '../context/request-context.ts'
import { dtoOf } from '../middleware/validation.ts'
import type { BaseCrudService } from '../service/base-crud.service.ts'

/**
 * Admin create/read/update handlers over a `BaseCrudService`. The route runs `requirePermission` and
 * `validate(schema)` first. No `try/catch`: Express 5 passes async errors to the error handler.
 */
export abstract class BaseCrudController<
  Row extends { id: string },
  CreateSchema extends z.ZodType,
  UpdateSchema extends z.ZodType,
  Body,
> {
  protected constructor(
    protected readonly service: BaseCrudService<Row, z.output<CreateSchema>, z.output<UpdateSchema>>,
    protected readonly schemas: { create: CreateSchema; update: UpdateSchema },
    protected readonly toBody: (row: Row) => Body,
  ) {}

  getItem = async (req: Request, res: Response) => {
    const body: Body = this.toBody(await this.service.getItem(String(req.params.id)))
    res.json(body)
  }

  createItem = async (req: Request, res: Response) => {
    const row = await this.service.create(dtoOf(res, this.schemas.create), contextOf(req))
    const body: Body = this.toBody(row)
    res.status(201).json(body)
  }

  updateItem = async (req: Request, res: Response) => {
    const row = await this.service.update(String(req.params.id), dtoOf(res, this.schemas.update), contextOf(req))
    const body: Body = this.toBody(row)
    res.json(body)
  }
}
