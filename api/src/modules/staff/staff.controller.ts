import type { Request, Response } from 'express'
import type { StaffList, StaffSummary } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { ChangeRolesDto, CreateStaffDto, StaffParams, UpdateStaffDto } from './dto/index.ts'
import type { StaffService } from './staff.service.ts'

export class StaffController {
  constructor(private readonly service: StaffService) {}

  private idOf(req: Request) {
    return parse(StaffParams, req.params).id
  }

  list = async (_req: Request, res: Response) => {
    const body: StaffList = { items: await this.service.list() }
    res.json(body)
  }

  create = async (req: Request, res: Response) => {
    const body: StaffSummary = await this.service.create(parse(CreateStaffDto, req.body), contextOf(req))
    res.status(201).json(body)
  }

  update = async (req: Request, res: Response) => {
    const input = parse(UpdateStaffDto, req.body)
    const body: StaffSummary = await this.service.update(this.idOf(req), input, contextOf(req))
    res.json(body)
  }

  changeRoles = async (req: Request, res: Response) => {
    const { roles } = parse(ChangeRolesDto, req.body)
    const body: StaffSummary = await this.service.changeRoles(this.idOf(req), roles, contextOf(req))
    res.json(body)
  }

  lock = async (req: Request, res: Response) => {
    const body: StaffSummary = await this.service.lock(this.idOf(req), contextOf(req))
    res.json(body)
  }

  unlock = async (req: Request, res: Response) => {
    const body: StaffSummary = await this.service.unlock(this.idOf(req), contextOf(req))
    res.json(body)
  }
}
