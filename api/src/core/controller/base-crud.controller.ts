import type { Request, Response } from 'express'
import type { z } from 'zod'
import { contextOf } from '../context/request-context.ts'
import { dtoOf } from '../middleware/validation.ts'
import type { RequestContext } from '../context/request-context.ts'

/** The service methods the handlers call; a `BaseCrudService` has them. */
export type CrudService<Row, Create, Update> = {
  getItem(id: string): Promise<Row>
  create(input: Create, ctx: RequestContext): Promise<Row>
  update(id: string, input: Update, ctx: RequestContext): Promise<Row>
}

/**
 * Admin create/read/update handlers over a `CrudService`. The route runs `requirePermission` and
 * `validate(schema)` first. No `try/catch`: Express 5 passes async errors to the error handler.
 */
export abstract class BaseCrudController<
  Row extends { id: string },
  CreateSchema extends z.ZodType,
  UpdateSchema extends z.ZodType,
  Body,
> {
  protected constructor(
    protected readonly service: CrudService<Row, z.output<CreateSchema>, z.output<UpdateSchema>>,
    protected readonly schemas: { create: CreateSchema; update: UpdateSchema },
    protected readonly toBody: (row: Row) => Body,
  ) {}

  /** The id from the URL; override to validate it (e.g. 400 for a malformed uuid). */
  protected idOf(req: Request): string {
    return String(req.params.id)
  }

  getItem = async (req: Request, res: Response) => {
    const body: Body = this.toBody(await this.service.getItem(this.idOf(req)))
    res.json(body)
  }

  createItem = async (req: Request, res: Response) => {
    const row = await this.service.create(dtoOf(res, this.schemas.create), contextOf(req))
    const body: Body = this.toBody(row)
    res.status(201).json(body)
  }

  updateItem = async (req: Request, res: Response) => {
    const row = await this.service.update(this.idOf(req), dtoOf(res, this.schemas.update), contextOf(req))
    const body: Body = this.toBody(row)
    res.json(body)
  }
}
